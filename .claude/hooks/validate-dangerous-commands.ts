#!/usr/bin/env -S deno run --allow-read --allow-env
/**
 * PreToolUse hook: 危険コマンドの検証
 *
 * プロジェクト外の絶対パスへの危険な操作をブロックする
 */

// 環境情報を動的に取得
const HOME = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
const PROJECT_DIR = Deno.cwd();

// 許可するディレクトリ
const ALLOWED_PATHS = [
  PROJECT_DIR,                          // プロジェクトディレクトリ
  "/tmp/claude",                        // Claude 一時ディレクトリ (Linux/macOS)
  "/private/tmp/claude",                // macOS の /tmp シンボリックリンク先
  `${HOME}/.claude/plugins/cache`,      // Claude プラグインキャッシュ（クリア用）
];

// 危険コマンドとその説明
const DANGEROUS_COMMANDS: Record<string, string> = {
  "rm": "ファイル/ディレクトリ削除",
  "mv": "ファイル移動/リネーム",
  "cp": "ファイルコピー（上書き可能）",
  "chmod": "パーミッション変更",
  "chown": "所有者変更",
  "kill": "プロセス終了",
  "pkill": "プロセス終了（パターン）",
  "killall": "プロセス終了（名前）",
  "sed": "ストリームエディタ（-i で破壊的）",
  "truncate": "ファイル切り詰め",
  "shred": "ファイル完全削除",
  "dd": "低レベルコピー（破壊的）",
};

// 絶対に禁止するパスパターン（クロスプラットフォーム対応）
const FORBIDDEN_PATTERNS = [
  // システムディレクトリ（共通）
  /^\/etc\//,           // システム設定
  /^\/usr\//,           // システムバイナリ
  /^\/bin\//,           // 基本コマンド
  /^\/sbin\//,          // システム管理コマンド
  /^\/var\//,           // 可変データ
  /^\/opt\//,           // オプションパッケージ
  // macOS 固有
  /^\/System\//,        // macOS システム
  /^\/Library\//,       // macOS ライブラリ
  /^\/Applications\//,  // macOS アプリケーション
  // ホームディレクトリの隠しファイル（macOS/Linux 両対応）
  /^~\/\./,             // ~/. で始まるパス
  /^\/Users\/[^/]+\/\./, // macOS: /Users/username/.xxx
  /^\/home\/[^/]+\//,   // Linux: /home/username/ 配下全般（プロジェクト外）
  // 機密ディレクトリ（パス内のどこにあってもブロック）
  /[/]\.ssh[/]/,        // SSH設定
  /[/]\.gnupg[/]/,      // GPG設定
  /[/]\.aws[/]/,        // AWS設定
  /[/]\.kube[/]/,       // Kubernetes設定
  /[/]\.docker[/]/,     // Docker設定
  /[/]\.config[/]/,     // 各種設定
];

interface HookInput {
  tool_name: string;
  tool_input: {
    command?: string;
    [key: string]: unknown;
  };
}

interface HookOutput {
  decision: "allow" | "block" | "ask";
  reason?: string;
}

function extractAbsolutePaths(command: string): string[] {
  // 絶対パスを抽出（クォート内も含む）
  const paths: string[] = [];

  // /で始まるパスを抽出
  const absolutePathRegex = /(?:^|[\s"'=])(\/([\w.\-\/]+))/g;
  let match;
  while ((match = absolutePathRegex.exec(command)) !== null) {
    paths.push(match[1]);
  }

  // ~ で始まるパスを抽出
  const homePathRegex = /(?:^|[\s"'=])(~\/([\w.\-\/]+))/g;
  while ((match = homePathRegex.exec(command)) !== null) {
    paths.push(match[1]);
  }

  return paths;
}

function getFirstCommand(command: string): string | null {
  // パイプやセミコロンで区切られた最初のコマンドを取得
  const trimmed = command.trim();

  // 環境変数の設定をスキップ
  const withoutEnv = trimmed.replace(/^(\w+=\S+\s+)+/, "");

  // 最初のコマンド部分を取得
  const firstWord = withoutEnv.split(/[\s|;&]/)[0];
  return firstWord || null;
}

function isDangerousCommand(command: string): { dangerous: boolean; cmd: string; reason: string } {
  const firstCmd = getFirstCommand(command);
  if (!firstCmd) {
    return { dangerous: false, cmd: "", reason: "" };
  }

  // コマンド名だけを取得（パスを除去）
  const cmdName = firstCmd.split("/").pop() || firstCmd;

  if (cmdName in DANGEROUS_COMMANDS) {
    return {
      dangerous: true,
      cmd: cmdName,
      reason: DANGEROUS_COMMANDS[cmdName],
    };
  }

  return { dangerous: false, cmd: cmdName, reason: "" };
}

function isPathAllowed(path: string): boolean {
  // ~ を展開
  const expandedPath = path.startsWith("~")
    ? path.replace("~", Deno.env.get("HOME") || "/Users/unknown")
    : path;

  // 許可リストに含まれるか
  for (const allowed of ALLOWED_PATHS) {
    if (expandedPath.startsWith(allowed)) {
      return true;
    }
  }

  return false;
}

function isForbiddenPath(path: string): { forbidden: boolean; pattern: string } {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(path)) {
      return { forbidden: true, pattern: pattern.toString() };
    }
  }
  return { forbidden: false, pattern: "" };
}

function hasSedInplaceEdit(command: string): boolean {
  // sed -i オプションの検出
  return /\bsed\s+(-[a-zA-Z]*i|--in-place)/.test(command);
}

async function main() {
  // stdin から JSON を読み取り
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];

  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }

  const input = decoder.decode(new Uint8Array(chunks.flatMap((c) => [...c])));

  let hookInput: HookInput;
  try {
    hookInput = JSON.parse(input);
  } catch {
    // JSON パースエラーは許可（フックの問題で操作をブロックしない）
    console.log(JSON.stringify({ decision: "allow" }));
    Deno.exit(0);
  }

  // Bash 以外は許可
  if (hookInput.tool_name !== "Bash") {
    console.log(JSON.stringify({ decision: "allow" }));
    Deno.exit(0);
  }

  const command = hookInput.tool_input.command;
  if (!command) {
    console.log(JSON.stringify({ decision: "allow" }));
    Deno.exit(0);
  }

  // 危険コマンドかチェック
  const { dangerous, cmd, reason } = isDangerousCommand(command);
  if (!dangerous) {
    console.log(JSON.stringify({ decision: "allow" }));
    Deno.exit(0);
  }

  // sed の場合、-i オプションがなければ許可
  if (cmd === "sed" && !hasSedInplaceEdit(command)) {
    console.log(JSON.stringify({ decision: "allow" }));
    Deno.exit(0);
  }

  // 絶対パスを抽出
  const paths = extractAbsolutePaths(command);

  // 絶対パスがない場合は相対パス（プロジェクト内）として許可
  if (paths.length === 0) {
    console.log(JSON.stringify({ decision: "allow" }));
    Deno.exit(0);
  }

  // 各パスをチェック
  for (const path of paths) {
    // 許可リストに含まれていれば禁止パターンチェックをスキップ
    if (isPathAllowed(path)) {
      continue;
    }

    // 禁止パターンに該当するか
    const { forbidden, pattern } = isForbiddenPath(path);
    if (forbidden) {
      const output: HookOutput = {
        decision: "block",
        reason: `[危険] ${cmd} (${reason}) がシステムパスを対象としています: ${path} (パターン: ${pattern})`,
      };
      console.log(JSON.stringify(output));
      Deno.exit(0);
    }

    // 許可リスト外の絶対パスはブロック
    const output: HookOutput = {
      decision: "block",
      reason: `[危険] ${cmd} (${reason}) がプロジェクト外の絶対パスを対象としています: ${path}\n許可パス: ${ALLOWED_PATHS.join(", ")}`,
    };
    console.log(JSON.stringify(output));
    Deno.exit(0);
  }

  // 全てのパスが許可範囲内
  console.log(JSON.stringify({ decision: "allow" }));
  Deno.exit(0);
}

main();
