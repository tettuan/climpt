# 12: Docs Filter

**What:** Tests documentation filtering by category, language, and mode.
**Why:** Ensures all filter options actually produce files, not just display
commands.

## Verifies

- `--category=guides` installs files (count > 0)
- `--lang=ja` installs files (count > 0)
- `--mode=flatten` installs files (count > 0)
- `--mode=single` installs files (count > 0)
