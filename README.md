<img width="1584" height="396" alt="image" src="https://github.com/user-attachments/assets/c10ca8a1-5dc7-4b05-a1f2-2cb6c58c57b5" />

# n8n Speckle Integration

Custom n8n nodes for integrating with [Speckle](https://speckle.systems). Load/query 3D models, upload files, manage issues, and monitor real-time updates in n8n workflows.

## Features

**Model Operations:**
- Load Model - Fetch complete model data from Speckle URL
- Query Objects - Filter and clean model objects (prioritizes DataObjects)
- Query Properties - Flatten nested BIM properties for easy processing
- Upload File - Upload IFC/DWG/OBJ/STL/3DM files to create new versions

**Issue Operations:**
- Get Issues - Fetch issues from projects/models/versions with optional replies

**Trigger:**
- Monitor models for new versions

## Installation

**Prerequisites:**
- Node.js 20.15+
- Docker & Docker Compose

**Setup:**
```bash
git clone https://github.com/mucahidyazar/n8n-nodes-starter.git
cd n8n-nodes-starter
npm install
npm run build
```

## Development

**Docker (Recommended):**
```bash
docker-compose up -d                    # Start n8n at http://localhost:5678
npm run build && docker-compose restart # After code changes
docker-compose logs -f n8n              # View logs
docker-compose down                     # Stop
```

**npm link (Alternative):**
```bash
npm run build && npm link
# In n8n directory: npm link n8n-nodes-starter
```

## Debugging

VS Code remote debugging configured for Docker. Press F5 and select "Attach to n8n in Docker" to debug TypeScript source.

See [DEBUGGING.md](DEBUGGING.md) for details.

## Commands

```bash
npm run dev        # Watch mode
npm run build      # Build nodes
npm run lint       # Check linting
npm run lintfix    # Fix linting
npm run format     # Format with Prettier
```

## Project Structure

```
nodes/Speckle/
├── Speckle.node.ts              # Main node (routes to handlers)
├── operations/                  # Operation handlers
│   ├── loadModel.ts
│   ├── queryObjects.ts
│   ├── queryProperties.ts
│   ├── uploadFile.ts
│   └── getIssues.ts
└── utils/                       # Shared utilities
    ├── graphql.ts
    ├── urlParsing.ts
    ├── propertyFlattening.ts
    └── ...

nodes/SpeckleTrigger/
└── SpeckleTrigger.node.ts       # WebSocket trigger

credentials/
└── SpeckleApi.credentials.ts    # Token auth
```

## Testing

1. `npm run build && docker-compose up -d`
2. Open http://localhost:5678
3. Add Speckle credentials (token + domain)
4. Create workflow with Speckle node/trigger
5. Execute and verify

For debugging, press F5 in VS Code to attach debugger.

## Resources

- [n8n Documentation](https://docs.n8n.io/)
- [Speckle API](https://speckle.guide/dev/)
- [DEBUGGING.md](DEBUGGING.md) - Debug guide
- [CLAUDE.md](CLAUDE.md) - Development guidance

## License

MIT
