# Debugging n8n Custom Nodes

This project is configured for remote debugging with VS Code while running n8n in Docker.

## Setup Complete ✓

The following has been configured:

1. **docker-compose.yml** - Debug port 9229 exposed and Node.js inspector enabled
2. **.vscode/launch.json** - VS Code debugger configuration
3. **tsconfig.json** - Source maps enabled (already configured)

## How to Debug

### Step 1: Start the Debugger

1. Open VS Code
2. Go to the **Run and Debug** panel (Ctrl+Shift+D / Cmd+Shift+D)
3. Select **"Attach to n8n in Docker"** from the dropdown
4. Click the green play button (or press F5)

You should see "Debugger attached" in the Debug Console.

### Step 2: Set Breakpoints

1. Open any TypeScript file in the `nodes/` or `credentials/` directory
2. Click in the gutter (left of line numbers) to set a breakpoint
3. The breakpoint should show as a red dot

**Example locations to set breakpoints:**
- `nodes/Speckle/Speckle.node.ts:691` - Inside Query Properties operation
- `nodes/Speckle/Speckle.node.ts:234` - Start of flattenRecordImpl function
- `nodes/Speckle/Speckle.node.ts:329` - Inside processNameValueRecord

### Step 3: Trigger Your Code

1. Open n8n in your browser: http://localhost:5678
2. Create or run a workflow that uses your custom node
3. When the code hits your breakpoint, execution will pause
4. You can now:
   - Inspect variables in the **Variables** panel
   - Step through code (F10 = step over, F11 = step into)
   - View the call stack
   - Use the Debug Console to evaluate expressions

### Step 4: Make Changes and Rebuild

If you need to modify your code:

1. Stop the debugger (Shift+F5)
2. Make your code changes
3. Rebuild: `npm run build`
4. Restart Docker: `docker-compose restart`
5. Reattach the debugger (F5)

**Quick rebuild command:**
```bash
npm run build && docker-compose restart
```

## Debugging Tips

### Source Maps Not Working?

If breakpoints show as gray (unbound), try:

1. Make sure you rebuilt after setting `sourceMap: true` in tsconfig.json
2. Verify the `dist/` folder contains `.map` files
3. Check that the debugger is attached (look for "Debugger attached" message)
4. Try setting breakpoints in the compiled `.js` files in `dist/` instead

### Inspecting Complex Objects

In the Debug Console, you can evaluate expressions:

```javascript
// View the entire inputData object
JSON.stringify(inputData, null, 2)

// Check if a property exists
'properties' in inputData

// View specific nested values
inputData.properties?.Parameters
```

### Conditional Breakpoints

Right-click on a breakpoint and select "Edit Breakpoint" to add conditions:

```javascript
// Only break when fieldName is "Depth"
fieldName === "Depth"

// Only break on the 3rd item
itemIndex === 2

// Only break when there's an error
error !== undefined
```

### Logpoints (Console.log without code changes)

Right-click in the gutter and select "Add Logpoint":

```javascript
inputData: {inputData}
Processing field: {fieldName} with value: {fieldValue}
```

## Troubleshooting

### "Cannot connect to runtime process"

- Make sure Docker container is running: `docker-compose ps`
- Check debugger is listening: `docker-compose logs n8n | grep inspect`
- Verify port 9229 is exposed: `docker-compose port n8n 9229`

### Breakpoints Not Hitting

- Ensure code is actually executing (check n8n workflow runs)
- Verify you're setting breakpoints in the right operation
- Try adding a `debugger;` statement directly in your code
- Check that source maps are generated in `dist/`

### Need to See Raw Logs?

```bash
# View all logs
docker-compose logs -f n8n

# Filter for your node
docker-compose logs n8n | grep -i speckle
```

## Advanced: Debugging Tests

To debug unit tests (if you add them later):

Add this configuration to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Tests",
  "program": "${workspaceFolder}/node_modules/jest/bin/jest",
  "args": ["--runInBand", "--no-cache"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

## Quick Reference

| Action | Shortcut |
|--------|----------|
| Start/Attach Debugger | F5 |
| Stop Debugger | Shift+F5 |
| Toggle Breakpoint | F9 |
| Step Over | F10 |
| Step Into | F11 |
| Step Out | Shift+F11 |
| Continue | F5 |
| Restart | Ctrl+Shift+F5 |

---

Happy debugging! 🐛
