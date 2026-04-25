# 13. Project Orchestration (v1.14.x)

> Status: draft (tmp). Target: `agents/docs/design/13_project_orchestration.md`
> after review. Level: 2 (Structure / Contract) per `/docs-writing` framework.

## 0. Context

v1.13.x は issue-based workflow (`kind:consider → kind:detail → kind:impl`) を
label 駆動で回す。v1.14.x では GitHub Projects v2 を **release 目標の unit**
として扱い、以下を実現する:

- project が issue の登録先 + list 取得条件になる
- project 目標の達成度が新 issue 起票判断の指標になる
- v1.13.x の issue workflow を壊さず共存させる

前提:

- **project の作成 / goal (readme) の記述は user が GH 側で直接行う** (gh CLI /
  Claude Code など climpt 外部で)
- climpt は与えられた project を **consume** する (list / read / bind / field
  update)
- ローカル state を持たない — GH が single source of truth (v1.13.x の issue
  扱いと同型)

## 1. Principle (Level 1 要約)

| 原則                      | 内容                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| P1 Stateless              | climpt は project/goal/membership を local に永続化しない。全て live query                                 |
| P2 Framework / Agent 分離 | climpt = generic primitive (read/bind/update/list)。user `.agent/<name>/` = intent (goal 解釈、評価、計画) |
| P3 Consumer               | project 作成と goal 記述は user 責務。climpt は given project に対してのみ動く                             |
| P4 BC                     | `projectBinding` 未設定時 v1.13.x と bitwise 同一動作                                                      |

## 2. Structure / Contract

### 2.1 Data model

Issue ↔ Project 関係:

- N:N (GH Projects v2 native)
- climpt 内に primary project 概念を持たない — 所属 project list は GH live
  query で取得
- 複数所属時は全 project readme を agent prompt に注入 (user agent が解釈)

Project representation (read-only consumption):

```ts
type Project = {
  id: string; // GraphQL node id "PVT_..."
  number: number; // owner-scoped
  owner: string;
  title: string;
  readme: string; // goal content authored by user on GH
  shortDescription: string | null;
  closed: boolean;
};

type ProjectItem = {
  id: string; // "PVTI_..."
  issueNumber: number;
  fieldValues: Record<string, unknown>;
};

type ProjectField = {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "single_select" | "iteration";
  options?: { id: string; name: string }[];
};

type ProjectRef = { owner: string; number: number } | { id: string };
type ProjectFieldValue = string | number | { optionId: string } | {
  date: string;
};
```

### 2.2 GitHubClient extensions (additive)

既存 interface は不変。以下を追加。全て live GH query (gh CLI wrap)。

**Read**

- `listUserProjects(owner: string): Promise<Project[]>`
- `getProject(ref: ProjectRef): Promise<Project>`
- `getIssueProjects(owner: string, issueNumber: number): Promise<Project[]>`
- `listProjectItems(projectId: string): Promise<ProjectItem[]>`
- `getProjectFields(projectId: string): Promise<ProjectField[]>`
- `getProjectItemIdForIssue(projectId: string, issueNumber: number): Promise<string | null>`

**Write**

- `addIssueToProject(projectId: string, issueNodeId: string): Promise<string /* itemId */>`
- `removeProjectItem(projectId: string, itemId: string): Promise<void>`
- `updateProjectItemField(projectId: string, itemId: string, fieldId: string, value: ProjectFieldValue): Promise<void>`
- `closeProject(projectId: string): Promise<void>`
- `createProjectFieldOption(project: ProjectRef, fieldId: string, name: string, color?: string): Promise<{ id: string; name: string }>`

**Intentionally NOT included** (user responsibility via direct gh CLI):

- `createProject` / `editProjectReadme`
- `createField`

理由: project schema (field, readme) の design は user intent。climpt
がこれを書き換えると境界崩壊。ただし field **option** の追加は例外とする (下記
bootstrap 責務を参照)。

**Status option bootstrap 責務**: orchestrator が F-d mapping 実行時に必要な
Status option (例: "Blocked") が project field に存在しなければ、
`createProjectFieldOption` で冪等に bootstrap する。既定 option (Todo / In
Progress / Done) は user が GH 側で管理し、climpt 固有の追加 option のみ
orchestrator が自動作成する。

### 2.3 OutboxAction additions

既存 union (`comment | create-issue | update-labels | close-issue`) を additive
拡張:

```ts
type OutboxAction =
  | /* existing 4 types unchanged */
  | { action: "add-to-project"; project: ProjectRef; issueNumber?: number }
  | { action: "remove-from-project"; project: ProjectRef; itemId: string }
  | { action: "update-project-item-field"; project: ProjectRef; itemId: string; fieldId: string; value: ProjectFieldValue }
  | { action: "close-project"; project: ProjectRef };
```

**Late-binding contract (new in OutboxProcessor)**:

`add-to-project` の `issueNumber` が省略された場合、同 outbox cycle
内で直前に実行された `create-issue` の返り値 (新 issue number) を参照する。

具体的:

- File naming: `000-deferred-NNN-create-issue.json` の直後に
  `000-deferred-NNN-add-to-project.json` (同じ `NNN` で pair)
- OutboxProcessor は action 実行後、結果を
  `prevResultByFamily: Map<string, ActionResult>` に保持
- 後続 action が `issueNumber` 不在かつ同 family の直前 action が `create-issue`
  成功 → その結果を注入

この契約は `DeferredItemsEmitter` の inheritance emission でのみ使われる。外部
writer はこの契約に依存してはならない。

### 2.4 Orchestrator hooks

**Hook O1: Project context injection on dispatch**

各 issue の agent dispatch 前に:

1. `getIssueProjects(owner, issueNumber)` を query
2. 所属 project が 1 個以上 **かつ**
   `workflow.json.projectBinding.injectGoalIntoPromptContext === true`:
   - agent prompt context に template 変数を注入:
     - `{{project_goals}}`: `Project[].readme` の配列
     - `{{project_titles}}`: `Project[].title` の配列
     - `{{project_numbers}}`: `Project[].number` の配列
     - `{{project_ids}}`: `Project[].id` の配列
3. 所属 0 個 または flag false: 注入なし

複数 project 所属時は全 readme を配列で渡す。どう weighting するかは user agent
の責務。

**Hook O2: Project inheritance on deferred_items**

`DeferredItemsEmitter` が agent output の `deferred_items[]` を処理する際:

1. Parent issue の project memberships を `getIssueProjects` で取得
2. 各 `deferred_item` について:
   - `projects` field 不在 **かつ**
     `workflow.json.projectBinding.inheritProjectsForCreateIssue === true` →
     parent の全 project を継承
   - `projects: []` 明示 → 継承しない (opt-out)
   - `projects: [...]` 明示 → その list を使用
3. 継承された project 1 個につき 1 個の `add-to-project` action を
   `create-issue` の直後に enqueue (late-bind)

### 2.5 workflow.json extension

optional block 1 個のみ追加 (不在 → v1.13.x 完全互換):

```json
{
  "projectBinding": {
    "injectGoalIntoPromptContext": true,
    "inheritProjectsForCreateIssue": true
  }
}
```

### 2.6 IssueCriteria extension (project-scoped execution)

既存 `IssueCriteria` に 1 field 追加:

```ts
type IssueCriteria = {
  labels?: string[];
  repo?: string;
  state?: "open" | "closed";
  limit?: number;
  project?: ProjectRef; // NEW
};
```

Resolution:

- `project` 未指定 → 従来通り全 repo issue から label/state filter
- `project` 指定 → `listProjectItems(projectId)` で issue 集合取得後 label/state
  filter

CLI:

- `deno task orchestrate --project <owner>/<number>` → `IssueCriteria.project`
  に展開
- prioritizer (`order:1..9`) はこの filter 後の集合に対して作用
  (既存ロジック不変)

### 2.7 CLI utilities (minimal)

project list 取得が user 要件。最小の 2 個のみ:

- `deno task project list [--owner <o>]` → `listUserProjects` wrap
- `deno task project items <owner>/<number>` → `listProjectItems` + field
  値集計表示

以下は提供しない (user は gh CLI / Claude Code 直接で行う):

- project 作成 / readme 編集 / field 作成 / agent bootstrap

### 2.8 DeferredItem schema extension

現行 (`considerer` schema):

```ts
type DeferredItem = { title: string; body: string; labels: string[] };
```

追加 optional field:

```ts
type DeferredItem = {
  title: string;
  body: string;
  labels: string[];
  projects?: ProjectRef[]; // NEW; absent = inherit parent's projects
};
```

Validation: 存在時は array of valid `ProjectRef`。空配列は「継承なし」の opt-out
signal。

### 2.9 Status field semantics

**climpt は Status field を自動更新しない**。

- v1.13.x の phase 遷移 (`kind:impl → done` 等) は GH Project の Status field
  に自動反映されない
- Status 管理が必要な user は `.agent/<name>/` の agent output で
  `update-project-item-field` outbox action を明示 emit する
- GH Project の field schema (option の種類、命名) は user が事前に GH 側で整備

理由: field schema は user の design 空間であり、climpt が勝手に mapping
を定義したり option を upsert すべきでない。v1.13.x workflow は labels
で完結しており、Status field は orthogonal な observability layer として user
に委ねる。

## 3. Invariants

| ID | Invariant                                                                                                |
| -- | -------------------------------------------------------------------------------------------------------- |
| I1 | `workflow.json.projectBinding` 不在 → v1.13.x と bitwise 同一動作                                        |
| I2 | Issue が 0 project 所属 → O1 goal 注入 skip, O2 inheritance は no-op                                     |
| I3 | `add-to-project` の late-bind `issueNumber` は同 outbox cycle の直前 `create-issue` 結果のみ参照可       |
| I4 | climpt は project の `readme` / field schema / option を書き換えない (write primitive 非提供)            |
| I5 | climpt は Status field を自動更新しない (user の明示 outbox action でのみ変化)                           |
| I6 | `IssueCriteria.project` 未指定 → 従来 dispatch behavior                                                  |
| I7 | 複数 project 所属 issue で deferred_items を継承した場合、継承先 issue は同一の全 project に bind される |

## 4. BC Matrix

| v1.13.x 動作                  | v1.14.x (projectBinding off) | v1.14.x (projectBinding on, issue 無所属) |
| ----------------------------- | ---------------------------- | ----------------------------------------- |
| dispatch                      | 同一                         | 同一                                      |
| label transition              | 同一                         | 同一                                      |
| deferred_items → create-issue | 同一                         | 同一 (継承 no-op)                         |
| close-issue                   | 同一                         | 同一                                      |
| outbox actions                | 4 種のみ使用                 | 4 種のみ使用                              |

v1.14.x の新機能は **user が explicit に on にしかつ issue を project
に登録した場合のみ** 起動する。

## 5. Boundary summary

| 責務                                | 担当                                                           |
| ----------------------------------- | -------------------------------------------------------------- |
| Project 作成                        | **user** (gh CLI / Claude Code 直接)                           |
| Goal (readme) 記述 / 更新           | **user** (gh project edit)                                     |
| Project field schema 設計           | **user** (gh project field-create)                             |
| Project list 取得                   | **climpt** (`listUserProjects`, `deno task project list`)      |
| Project metadata 読込 (readme 含む) | **climpt** (`getProject`)                                      |
| Issue → project 所属 query          | **climpt** (`getIssueProjects`)                                |
| Project items 一覧                  | **climpt** (`listProjectItems`, `deno task project items`)     |
| Issue を project に追加             | **climpt** (outbox `add-to-project`, O2 継承)                  |
| Goal を agent prompt に注入         | **climpt** (O1)                                                |
| Goal の解釈 / 達成度評価            | **user `.agent/<name>/`**                                      |
| 起票すべき追加 issue の判断         | **user `.agent/<name>/`** (`deferred_items` emission)          |
| Status field 更新                   | **user `.agent/<name>/`** (outbox `update-project-item-field`) |
| Project 完了判断 / close            | **user `.agent/<name>/`** (outbox `close-project`)             |
| Release PR 作成                     | **user** (manual, `/release-procedure`)                        |

## 6. Level 3: Open design decisions

旧 item 1 (OutboxProcessor inter-action state) は §2.3 late-binding contract
(L119-134) で定義済み、#487 で実装済み。以下 4 項目が残る未解決事項であり、
各項目に chosen default / rationale / implementation note を記載する。

### 6.1 Cache / rate-limit

**Default**: Process-lifetime `Map<string, {data, expiry}>` cache、TTL 30 秒。

**Rationale**: GitHub GraphQL API は 5,000 points/hour。典型的な dispatch cycle
(issue 10-20 件) では数十 calls — ceiling の 1% 未満。O1 (goal injection) が
実装されても数百 calls/cycle で上限には到達しない。TTL 30 秒は単一 dispatch
cycle (秒〜低分) 内の重複呼び出しを排除し、cycle 間は `countdownDelay`
またはプロセス 再起動で自然に expire する。明示的 invalidation 不要。P1
(Stateless) との整合: 永続化しない in-memory cache は stateless 原則を破らない。

**Implementation note**: `GhCliClient` 内に
`#cache: Map<string, {data: unknown,
expiry: number}>` を追加。各 read メソッド
(`listUserProjects`, `getProject`, `getIssueProjects`, `listProjectItems`,
`getProjectFields`, `getProjectItemIdForIssue`) の先頭で `#cacheGet(key)` → hit
なら return、miss なら fetch + `#cacheSet(key, data, ttlMs=30_000)`。

### 6.2 Sandbox allow-list

**Default**: 変更不要。

**Rationale**: `gh project *` コマンドは orchestrator (host process) の
`Deno.Command()` で実行される。Agent SDK sandbox は agent 内部の Bash tool
実行に のみ適用される。orchestrator は agent の外側で動くため sandbox boundary
の外にいる。 `sandbox-defaults.ts:25-28` のコメントが設計を明示: "System paths
(Boundary Hook, worktree, orchestrator) use Deno.Command outside the sandbox and
are not affected." agent 側から直接 `gh project` を実行する use case は §5
Boundary summary で排除されている (project 操作は climpt framework の責務)。

**Implementation note**: 実装不要。現行の `sandbox-defaults.ts` を維持。

### 6.3 `getIssueProjects` failure fallback

**Default**: Skip silently (warn log + continue dispatch)。

**Rationale**: Goal injection (O1) は supplementary context であり agent
の必須入力 ではない — `{{project_goals}}` が空でも agent は label-based workflow
で正常に動作 する。P1 (Stateless) により cached fallback data は持たない — block
か skip の 二択。dispatch cycle を block すると全 issue
の進行が停止し、transient error で 全停止は不均衡。warning log で operator
が検知可能、次の dispatch cycle で自然に リトライされる。

**Implementation note**: `orchestrator.ts` の O1 hook
実装時に以下のパターンで実装:

```typescript
try {
  const projects = await this.#github.getIssueProjects(owner, issueNumber);
  // inject {{project_goals}} etc.
} catch (err) {
  await log.warn(
    `Project goal injection skipped for #${issueNumber}: ${err.message}`,
    {
      event: "project_injection_skipped",
      subjectId: issueNumber,
      error: err.message,
    },
  );
  // continue dispatch without project context
}
```

T6.eval (`orchestrator.ts:843`) の completion check も同様: skip +
warn。sentinel 評価は次の close event で再試行される。

### 6.4 Multi-owner scope

**Default**: 暗黙のデフォルト owner を持たない (常に明示指定)。

**Rationale**: GH Projects v2 の `number` は owner-scoped — `tettuan/1` と
`my-org/1` は別 project。`ProjectRef { owner, number }` は owner-scoped number
で 十分に disambiguate する。`getIssueProjects` が `{ owner, number }`
を返すため、 O2 inheritance 時に owner 情報が自然に伝播する。暗黙の owner
(GitHub user endpoint から推定) は組織 project
を見落とすリスクがある。`listUserProjects` は CLI utility (探索用) であり
dispatch 本流には使われない。

**Implementation note**: 実装不要。現行の `ProjectRef { owner, number }` 型と
`listUserProjects(owner: string)` の明示 owner 引数を維持。

## 7. 関連

- `02_core_architecture.md` の Stateless 原則を Project に拡張
- `10_extension_points.md` に OutboxAction / IssueCriteria の拡張を追記
- `12_orchestrator.md` に O1 / O2 hook を追記
