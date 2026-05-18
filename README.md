```bash
npm install
npm run reproduce
```

Sets `PLAYWRIGHT_BROWSERS_PATH` to a read-only directory, starts the MCP server, and sends a `browser_navigate` call. Fails with:

```
Error: EACCES: permission denied, mkdir '<PLAYWRIGHT_BROWSERS_PATH>/mcp-chrome-for-testing-<hash>'
```
