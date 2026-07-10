# MigraPilot AI Engineer

MigraPilot AI Engineer is a VS Code extension that provides an AI-powered engineering command center for building, fixing, deploying, and operating the MigraTeck ecosystem.

## Features

- **Read-only MVP**: Provides a read-only interface for AI engineering assistance
- **Workspace Context**: Displays current workspace, active file, and language information
- **Suggested Actions**: Quick buttons for common engineering tasks
- **Chat Interface**: Interactive chat for asking questions about code
- **Voice Command Support**: Placeholder for voice command integration

## Commands

- `MigraPilot: Open Chat` - Open the AI engineer chat view
- `MigraPilot: Explain Current File` - Explain the currently active file
- `MigraPilot: Review Selection` - Review selected code
- `MigraPilot: Start Agent Task` - Start an agent task for code analysis
- `MigraPilot: Open Voice Command` - Open voice command interface
- `MigraPilot: Open Command Center` - Open the command center
- `MigraPilot: Show Current Context` - Display current workspace context

## Limitations (Read-only MVP)

This is a read-only MVP version with the following limitations:
- No file writes
- No commands execution
- No deploys
- No backend calls
- No voice command functionality

## Development

To build and run this extension locally:

1. Install dependencies: `npm install`
2. Build the extension: `npm run compile`
3. Run in VS Code using the Debug configuration

## License

MIT
