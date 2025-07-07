# climpt

A CLI tool for managing prompts and AI interactions.

## Features

- Manage and organize prompts
- Configure AI providers
- Run prompts with dynamic variables
- Simple and intuitive command-line interface

## Installation

### From JSR

```bash
deno install --allow-read --allow-write jsr:@aidevtool/climpt
```

### From source

```bash
git clone https://github.com/tettuan/climpt.git
cd climpt
deno install --allow-read --allow-write --name climpt cli.ts
```

## Usage

```bash
# Show version
climpt --version

# Show help
climpt --help

# List prompts
climpt prompt list

# Configure AI provider
climpt config set provider openai

# Run a prompt
climpt run my-prompt
```

## Development

```bash
# Run in development mode
deno task dev

# Run tests
deno task test

# Build executable
deno task build
```

## License

MIT License - see [LICENSE](LICENSE) file for details.
