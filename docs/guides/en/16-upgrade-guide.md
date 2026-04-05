# 16. Upgrade Guide

How to update Climpt to the latest version.

## Step 1: Check Current Version

```bash
deno run -A jsr:@aidevtool/climpt/cli --version
```

Note the output (e.g. `Climpt v1.13.17`) for comparison after update.

## Step 2: Update Package with Cache Reload

The `-r` flag forces Deno to bypass cache and fetch the latest from JSR:

```bash
deno run -Ar jsr:@aidevtool/climpt/cli --version
```

If the version number increased, the update succeeded. If unchanged, you are
already on the latest.

## Step 3: Update Documentation

Install (or overwrite) docs into your project:

```bash
deno run -Ar jsr:@aidevtool/climpt/docs install .agent/climpt/docs
```

### Options

| Flag                   | Purpose                         | Example                |
| :--------------------- | :------------------------------ | :--------------------- |
| `--lang=ja`            | Japanese only                   | `--lang=ja`            |
| `--lang=en`            | English only                    | `--lang=en`            |
| `--category=guides`    | Guides only                     | `--category=guides`    |
| `--category=reference` | Reference only                  | `--category=reference` |
| `--mode=flatten`       | Flat layout (no subdirectories) | `--mode=flatten`       |
| `--mode=single`        | Merge all into one file         | `--mode=single`        |

## Step 4: Validate

### 4a. Version

```bash
deno run -A jsr:@aidevtool/climpt/cli --version
```

### 4b. Re-initialize

```bash
deno run -A jsr:@aidevtool/climpt/cli init --force
```

Verify `.agent/climpt/config/` and `.agent/climpt/prompts/` exist.

### 4c. Echo Test

```bash
echo "hello" | deno run -A jsr:@aidevtool/climpt/cli echo input --config=test
```

Output should contain `hello`. Skip this if the `test` config is not set up.

### 4d. Docs List

```bash
deno run -A jsr:@aidevtool/climpt/docs list
```

Verify entries show the latest version.

## Troubleshooting

| Symptom                      | Solution                                                                                                                                       |
| :--------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| Version unchanged after `-r` | On macOS, Deno cache may exist in both `~/.cache/deno` and `~/Library/Caches/deno`. Try `deno cache --reload jsr:@aidevtool/climpt` explicitly |
| JSR fetch failure            | Check network. For proxy environments, set `HTTPS_PROXY`                                                                                       |
| init failure                 | Check write permissions on `.agent/climpt/`. Use `--force` to overwrite                                                                        |
| docs install failure         | Check write permissions on the target directory                                                                                                |
