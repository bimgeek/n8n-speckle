# n8n Speckle Integration

Custom n8n nodes for integrating with the [Speckle](https://speckle.systems) API. Load, query, and process 3D models and BIM data directly in your n8n workflows.

## Features

### Speckle Node

The Speckle node provides three operations for working with Speckle models:

#### 1. Load Model
Load complete 3D model data from a Speckle model URL.

- **Input**: Speckle model URL (e.g., `https://app.speckle.systems/projects/{projectId}/models/{modelId}`)
- **Output**: Array of model objects with metadata
- **Features**:
  - Automatic reference resolution (fetches missing child objects)
  - Attribute masking to exclude heavy geometry data (`vertices`, `faces`, `colors`)
  - Efficient batch downloading using Speckle's object stream API

#### 2. Query Objects
Filter and clean objects from loaded models.

- **Input**: Array output from Load Model operation
- **Output**: Individual filtered objects (one per n8n item)
- **Features**:
  - Intelligent filtering: prioritizes DataObjects when present
  - Removes unnecessary metadata (`__closure`, `totalChildrenCount`)
  - Excludes technical types (`DataChunk`, `RawEncoding`)

#### 3. Query Properties
Flatten nested BIM properties into a single-level object for easy data processing.

- **Input**: Individual objects from Query Objects operation
- **Output**: Flattened property object
- **Features**:
  - Extracts nested properties into dot-notation keys
  - Handles Revit parameter pattern (name/value records)
  - Resolves naming conflicts with parent path segments
  - Excludes complex structures (Material Quantities, Composite Structure, etc.)
  - Preserves arrays as-is

**Example transformation:**
```javascript
// Input
{
  "properties": {
    "Parameters": {
      "Type Parameters": {
        "Dimensions": {
          "Depth": { "name": "Depth", "value": 600 }
        }
      }
    }
  }
}

// Output
{
  "Depth": 600
}
```

### HTTP Verb Resource
Demonstrates declarative routing patterns for simple API operations:
- GET requests with query parameters
- DELETE requests with optional JSON body

## Installation

### Prerequisites

- Node.js 20.15 or higher
- Docker and Docker Compose (for local development)
- n8n 2.3.4 or higher (local Docker setup uses pinned version)

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mucahidyazar/n8n-nodes-starter.git
   cd n8n-nodes-starter
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the nodes:**
   ```bash
   npm run build
   ```

## Local Development

### Docker Setup (Recommended)

The project includes a Docker Compose configuration for local development with n8n 2.3.4.

#### Environment Variables

The Docker setup includes the following n8n configuration:

| Variable | Value | Description |
|----------|-------|-------------|
| `N8N_CUSTOM_EXTENSIONS` | `/home/node/.n8n/custom` | Custom nodes directory |
| `N8N_DEFAULT_BINARY_DATA_MODE` | `filesystem` | Store binary data on disk |
| `NODE_FUNCTION_ALLOW_EXTERNAL` | `*` | Allow external npm packages in Code nodes |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false` | Allow environment variable access in Code nodes |
| `N8N_RUNNERS_ENABLED` | `false` | Disable task runners for simpler setup |
| `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS` | `false` | Skip file permission checks (macOS compatibility) |
| `NODE_PATH` | `/usr/local/lib/node_modules` | Include global modules for dependencies |

#### Quick Start

1. **Start n8n with your custom nodes:**
   ```bash
   docker-compose up -d
   ```

2. **Access n8n:**
   Open http://localhost:5678 in your browser

3. **After making code changes:**
   ```bash
   npm run build && docker-compose restart
   ```

4. **View logs:**
   ```bash
   docker-compose logs -f n8n
   ```

5. **Stop n8n:**
   ```bash
   docker-compose down
   ```

#### Upgrading n8n Version

To upgrade to a newer n8n version, update the version in `Dockerfile`:

```dockerfile
FROM n8nio/n8n:2.3.4  # Change to desired version
```

Then rebuild:
```bash
docker-compose build --no-cache && docker-compose up -d
```

### npm link Setup (Alternative)

For non-Docker setups:

1. Build and link the package:
   ```bash
   npm run build
   npm link
   ```

2. In your n8n installation directory:
   ```bash
   npm link n8n-nodes-starter
   ```

3. Restart n8n

## Debugging

This project is configured for **remote debugging with VS Code** while running n8n in Docker.

### Quick Start

1. **Start the debugger:**
   - Open VS Code
   - Go to **Run and Debug** panel (Ctrl+Shift+D)
   - Select **"Attach to n8n in Docker"**
   - Press **F5**

2. **Set breakpoints:**
   - Open any TypeScript file in `nodes/` or `credentials/`
   - Click in the gutter to set breakpoints

3. **Trigger your code:**
   - Run a workflow in n8n that uses your custom node
   - Execution will pause at your breakpoints

### Debug Configuration

The following files are already configured:

- **docker-compose.yml** - Exposes debug port 9229 with Node.js inspector
- **.vscode/launch.json** - VS Code debugger configuration
- **tsconfig.json** - Source maps enabled for TypeScript debugging

### Common Breakpoint Locations

```typescript
// Query Properties operation start
nodes/Speckle/Speckle.node.ts:691

// Main flattening function
nodes/Speckle/Speckle.node.ts:234

// Name/value record processing
nodes/Speckle/Speckle.node.ts:329
```

### Debugging Tips

**Inspect complex objects in Debug Console:**
```javascript
JSON.stringify(inputData, null, 2)
```

**Conditional breakpoints:**
Right-click a breakpoint → Edit Breakpoint
```javascript
fieldName === "Depth"
itemIndex === 2
```

**Logpoints (no code changes needed):**
Right-click in gutter → Add Logpoint
```javascript
Processing field: {fieldName} with value: {fieldValue}
```

For detailed debugging instructions, see [DEBUGGING.md](DEBUGGING.md).

## Available Commands

### Development
```bash
npm run dev        # Watch mode with TypeScript compilation
npm run build      # Full build (clean + compile + copy icons)
npm run lint       # Lint nodes, credentials, and package.json
npm run lintfix    # Auto-fix linting errors
npm run format     # Format code with Prettier
```

### Publishing
```bash
npm run prepublishOnly  # Build + strict linting (runs before npm publish)
```

### Docker
```bash
docker-compose up -d        # Start n8n
docker-compose logs -f n8n  # View logs
docker-compose restart      # Restart after code changes
docker-compose down         # Stop and remove containers
```

## Project Structure

```
n8n-speckle/
├── nodes/
│   ├── Speckle/
│   │   ├── Speckle.node.ts           # Main node implementation
│   │   ├── LoadModelDescription.ts   # Model operations config
│   │   ├── HttpVerbDescription.ts    # HTTP operations config
│   │   └── speckle.svg               # Node icon
│   └── ExampleNode/                  # Reference examples
├── credentials/
│   ├── SpeckleApi.credentials.ts     # Speckle authentication
│   └── ExampleCredentialsApi.credentials.ts
├── dist/                              # Compiled output (gitignored)
├── .vscode/
│   └── launch.json                   # Debug configuration
├── docker-compose.yml                # Local development setup
├── tsconfig.json                     # TypeScript configuration
├── CLAUDE.md                         # AI assistant guidance
├── DEBUGGING.md                      # Detailed debugging guide
└── README.md                         # This file
```

## Architecture

### Node Patterns

This project demonstrates both **declarative** and **programmatic** node patterns:

**Declarative (HTTP Verb resource)**
- Uses `routing` configuration for simple API calls
- No `execute()` method needed
- n8n handles request/response automatically

**Programmatic (Model resource)**
- Implements `execute()` method for complex logic
- Manual input processing and error handling
- Used for multi-step operations (Load Model, Query Objects, Query Properties)

**Hybrid (Speckle node)**
- Combines both patterns in one node
- Simple operations use declarative routing
- Complex operations use programmatic execution

### Speckle Operations Implementation

#### Load Model (lines 453-640)
1. Parse Speckle URL to extract `projectId` and `modelId`
2. GraphQL query to get model metadata and root object ID
3. Initialize ObjectLoader2 with attribute masking
4. Download objects via iterator
5. Resolve missing object references (up to 10 iterations)

#### Query Objects (lines 643-681)
1. Validate input is an array
2. Clean objects (remove `__closure`, `totalChildrenCount`, etc.)
3. Detect if model contains DataObjects
4. Filter objects based on type
5. Flatten array to individual items

#### Query Properties (lines 683-711)
1. Process each input item separately
2. Extract and flatten the `properties` field
3. Use recursive algorithm with these helpers:
   - `isPathExcluded()` - Skip excluded paths
   - `resolveFieldName()` - Handle naming conflicts
   - `processNameValueRecord()` - Extract name/value patterns
   - `processNestedRecord()` - Recursive flattening
   - `processPrimitiveValue()` - Handle leaf values

### Credentials

**SpeckleApi** credentials support:
- Token-based authentication (Bearer token)
- Configurable Speckle domain (defaults to `https://app.speckle.systems`)
- Automatic credential validation via GraphQL

## Example Workflow

1. **Load Model** - Fetch model from Speckle URL
2. **Query Objects** - Filter to relevant objects (e.g., only DataObjects)
3. **Query Properties** - Flatten properties for each object
4. **Process** - Use flattened data in downstream nodes (CSV, database, etc.)

## Speckle Properties Flattening

The Query Properties operation implements a sophisticated flattening algorithm designed for BIM data:

### Key Features

- **Name/Value Pattern**: Extracts Revit-style parameters
  ```javascript
  { "name": "Depth", "units": "mm", "value": 600 } → { "Depth": 600 }
  ```

- **Conflict Resolution**: Appends parent path segments when field names conflict
  ```javascript
  // Two "volume" fields become:
  { "volume": 0.5, "volume.Metal": 0.3 }
  ```

- **Path Exclusion**: Skips complex/redundant structures
  - `Composite Structure`
  - `Material Quantities`
  - `Parameters.Type Parameters.Structure`

- **Array Preservation**: Arrays are kept as-is (not flattened)

For the complete algorithm specification, see [claude helpers/SPECKLE_PROPERTIES_FLATTENING.md](claude%20helpers/SPECKLE_PROPERTIES_FLATTENING.md).

## Linting

Uses `eslint-plugin-n8n-nodes-base` with strict rules:

```bash
npm run lint       # Check for errors
npm run lintfix    # Auto-fix when possible
```

Separate rule sets for:
- `package.json` - Package metadata validation
- `.credentials.ts` - Credential type conventions
- `.node.ts` - Node implementation standards

## Build Process

1. **Clean**: Remove existing `dist/` folder
2. **Compile**: TypeScript → JavaScript with source maps
3. **Copy Icons**: SVG/PNG files to `dist/`
4. **Generate**: Type declarations (`.d.ts`)

Output in `dist/` is mounted to n8n's custom extensions directory in Docker.

## Testing

### Manual Testing
1. Build and start Docker: `npm run build && docker-compose up -d`
2. Create a workflow in n8n (http://localhost:5678)
3. Add Speckle credentials (token + optional domain)
4. Add Speckle node and configure operation
5. Execute workflow and verify results

### Debug Testing
1. Set breakpoints in VS Code
2. Attach debugger (F5)
3. Run workflow in n8n
4. Inspect variables and step through code

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run linting: `npm run lint`
5. Format code: `npm run format`
6. Test locally with Docker
7. Commit changes: `git commit -am 'Add my feature'`
8. Push to branch: `git push origin feature/my-feature`
9. Create a Pull Request

## Publishing

To publish to npm:

1. Update version in `package.json`
2. Update `package.json` metadata (name, description, author, etc.)
3. Run pre-publish checks:
   ```bash
   npm run prepublishOnly
   ```
4. Publish to npm:
   ```bash
   npm publish
   ```

For n8n cloud verification, see: [Submit Community Nodes](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/)

## Resources

- [n8n Documentation](https://docs.n8n.io/)
- [Creating n8n Nodes](https://docs.n8n.io/integrations/creating-nodes/)
- [Speckle API Documentation](https://speckle.guide/dev/)
- [ObjectLoader2 Documentation](https://github.com/specklesystems/speckle-server/tree/main/packages/objectloader)

## License

[MIT](LICENSE.md)

## Support

For issues and questions:
- Open an issue on GitHub
- Check the [DEBUGGING.md](DEBUGGING.md) guide for troubleshooting
- Review [CLAUDE.md](CLAUDE.md) for development guidance
