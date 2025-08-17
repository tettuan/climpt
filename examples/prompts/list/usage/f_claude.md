---
title: Climpt Available Commands List Generation (Claude Code Version)
description: Generates available commands list using Claude Code with shell scripting. Lists prompt files mechanically with sh, then analyzes each file content using claude -p in a loop.
usage: climpt list usage --adaptation=claude-code
---

# Implementation Tasks

Create a list of available Climpt commands using Claude Code with shell automation.

## What is Climpt

Deno JSR @https://jsr.io/@aidevtool/climpt.
A tool designed to output prompts via CLI.
Replaces variables in prompt templates based on values passed as parameters.

Normal usage:
```zsh
climpt-* <Directive> <Layer> --*
```

STDIN usage:
```zsh
echo "something" | climpt-* <Directive> <Layer> --*
```

## Execution Plan

This implementation uses Claude Code's shell capabilities to:
1. Mechanically list prompt files using shell commands
2. Loop through files and analyze content using `claude -p`
3. Generate structured output

## Step 1: Initialize Output File

First, create or clear the output file:

```bash
# Initialize the output file
cat > .agent/climpt/tools-list.md << 'EOF'
# Climpt Available Commands List

Generated on: $(date)

EOF
```

## Step 2: Discover Executable Commands

Use shell to find all executable commands:

```bash
# Find all climpt-* executables
ls -1 .deno/bin/climpt-* 2>/dev/null | while read cmd; do
    command_name=$(basename "$cmd")
    echo "## $command_name" >> .agent/climpt/tools-list.md
    echo "" >> .agent/climpt/tools-list.md
    echo "|directive|layer|input(-i)|adaptation(-a)|input_text_file(-f)|input_text(STDIN)|destination(-o)|" >> .agent/climpt/tools-list.md
    echo "|---|---|---|---|---|---|---|" >> .agent/climpt/tools-list.md
done
```

## Step 3: List Prompt Files for Each Command

For each command, find associated prompt files:

```bash
# Process each command directory
for cmd_dir in .deno/bin/climpt-*; do
    if [ -f "$cmd_dir" ]; then
        command_name=$(basename "$cmd_dir" | sed 's/climpt-//')
        prompt_base=".agent/climpt/prompts/$command_name"
        
        # Find all prompt files for this command
        if [ -d "$prompt_base" ]; then
            find "$prompt_base" -name "f_*.md" -type f | sort > /tmp/prompt_files_$command_name.txt
        fi
    fi
done
```

## Step 4: Process Each Prompt File

Loop through prompt files and analyze with claude -p:

```bash
# Process each command's prompt files
for cmd_dir in .deno/bin/climpt-*; do
    command_name=$(basename "$cmd_dir" | sed 's/climpt-//')
    prompt_list_file="/tmp/prompt_files_$command_name.txt"
    
    if [ -f "$prompt_list_file" ]; then
        while IFS= read -r prompt_file; do
            # Extract path components
            rel_path=${prompt_file#.agent/climpt/prompts/}
            
            # Parse directive/layer/input/adaptation from path
            # Format: <command>/<directive>/<layer>/f_<input>_<adaptation>.md
            directive=$(echo "$rel_path" | cut -d'/' -f2)
            layer=$(echo "$rel_path" | cut -d'/' -f3)
            filename=$(basename "$prompt_file")
            
            # Extract input and adaptation from filename
            input_part=$(echo "$filename" | sed 's/^f_//' | sed 's/_.*$//')
            adaptation_part=$(echo "$filename" | sed 's/^f_[^_]*_//' | sed 's/\.md$//')
            
            # If no underscore, adaptation is empty
            if [ "$input_part" = "${filename#f_}" ]; then
                input_part="default"
                adaptation_part=""
            fi
            
            # Store file info for claude processing
            echo "$prompt_file|$command_name|$directive|$layer|$input_part|$adaptation_part" >> /tmp/prompt_analysis_queue.txt
        done < "$prompt_list_file"
    fi
done
```

## Step 5: Analyze File Contents with Claude

Create a prompt for claude to analyze each file:

```bash
# Process each file with claude -p
while IFS='|' read -r filepath cmd directive layer input adaptation; do
    # Use claude -p to analyze the prompt file
    claude -p << 'CLAUDE_PROMPT' "$filepath" > /tmp/claude_result.json
Analyze this Climpt prompt file and extract the following information in JSON format:

1. Check for frontmatter (YAML between --- markers) and extract:
   - title
   - description
   - usage
   - any other fields

2. Find all template variables in the format {variable_name} and identify:
   - Which correspond to standard options:
     - {input_text} → STDIN input
     - {input_file} or similar → -f/--from option
     - {destination_path} → -o/--destination option
     - {uv-*} → --uv-* user variables
   
3. Return JSON in this format:
{
  "has_frontmatter": boolean,
  "frontmatter": {
    "title": "string or null",
    "description": "string or null",
    "usage": "string or null"
  },
  "variables": ["list of {variable} names found"],
  "options": {
    "has_input_file": boolean,
    "has_stdin": boolean,
    "has_destination": boolean,
    "user_variables": ["list of uv-* variables"]
  }
}

File to analyze:
CLAUDE_PROMPT

    # Parse claude's JSON response and update the markdown table
    has_input_file=$(jq -r '.options.has_input_file' /tmp/claude_result.json)
    has_stdin=$(jq -r '.options.has_stdin' /tmp/claude_result.json)
    has_destination=$(jq -r '.options.has_destination' /tmp/claude_result.json)
    title=$(jq -r '.frontmatter.title // ""' /tmp/claude_result.json)
    description=$(jq -r '.frontmatter.description // ""' /tmp/claude_result.json)
    
    # Convert boolean to checkmark
    [ "$has_input_file" = "true" ] && input_file_mark="✓" || input_file_mark="-"
    [ "$has_stdin" = "true" ] && stdin_mark="✓" || stdin_mark="-"
    [ "$has_destination" = "true" ] && dest_mark="✓" || dest_mark="-"
    [ -n "$adaptation" ] && adapt_mark="$adaptation" || adapt_mark="-"
    [ -n "$input" ] && input_mark="$input" || input_mark="-"
    
    # Append to command's table
    echo "| $directive | $layer | $input_mark | $adapt_mark | $input_file_mark | $stdin_mark | $dest_mark |" >> /tmp/table_${cmd}.txt
    
    # Store details for later
    if [ -n "$title" ] || [ -n "$description" ]; then
        echo "" >> /tmp/details_${cmd}.txt
        echo "**climpt-$cmd $directive $layer --adaptation=$adaptation**:" >> /tmp/details_${cmd}.txt
        [ -n "$title" ] && echo "$title" >> /tmp/details_${cmd}.txt
        [ -n "$description" ] && echo "$description" >> /tmp/details_${cmd}.txt
    fi
    
done < /tmp/prompt_analysis_queue.txt
```

## Step 6: Assemble Final Output

Combine all parts into the final markdown file:

```bash
# Assemble the final output
for cmd_dir in .deno/bin/climpt-*; do
    command_name=$(basename "$cmd_dir" | sed 's/climpt-//')
    
    # Add command section header
    echo "## climpt-$command_name" >> .agent/climpt/tools-list.md
    echo "" >> .agent/climpt/tools-list.md
    
    # Add table header
    echo "|directive|layer|input(-i)|adaptation(-a)|input_text_file(-f)|input_text(STDIN)|destination(-o)|" >> .agent/climpt/tools-list.md
    echo "|---|---|---|---|---|---|---|" >> .agent/climpt/tools-list.md
    
    # Add table rows
    if [ -f "/tmp/table_climpt-${command_name}.txt" ]; then
        cat "/tmp/table_climpt-${command_name}.txt" >> .agent/climpt/tools-list.md
    fi
    
    echo "" >> .agent/climpt/tools-list.md
    
    # Add command details
    if [ -f "/tmp/details_climpt-${command_name}.txt" ]; then
        cat "/tmp/details_climpt-${command_name}.txt" >> .agent/climpt/tools-list.md
    fi
    
    echo "" >> .agent/climpt/tools-list.md
done

# Cleanup temporary files
rm -f /tmp/prompt_files_*.txt
rm -f /tmp/prompt_analysis_queue.txt
rm -f /tmp/claude_result.json
rm -f /tmp/table_*.txt
rm -f /tmp/details_*.txt
```

## Output Destination

`.agent/climpt/tools-list.md`

## Execution Summary

This Claude Code version:
1. Uses shell commands (`ls`, `find`, `while`, `for`) to mechanically list files
2. Processes each file in a loop using `claude -p` for content analysis
3. Claude analyzes frontmatter and variables in each prompt file
4. Results are assembled into the final markdown documentation

## Benefits of this Approach

- **Mechanical file discovery**: Shell handles all file system operations
- **Parallel processing possible**: Can be modified to run multiple claude -p in parallel
- **Incremental updates**: Can process only changed files
- **Clear separation**: Shell for file operations, Claude for content analysis
- **Debugging friendly**: Intermediate results in /tmp for inspection

## Example Usage

To execute this entire process:

```bash
# Make it executable and run
chmod +x generate_tools_list.sh
./generate_tools_list.sh
```

Or run directly in Claude Code:
```bash
# Execute the complete workflow
bash -c "$(cat examples/prompts/list/usage/f_claude_code.md | sed -n '/^```bash$/,/^```$/p' | sed '/^```/d')"
```