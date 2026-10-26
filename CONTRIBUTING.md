# Contributing

Use Node.js 22 or later on Linux or macOS. The project uses only Node built-ins at runtime; no dependency installation is required.

```sh
npm test
npm run check
```

Tests use local mock servers and temporary directories, not real models. Never add live API calls to CI. Do not commit API keys, raw live responses, private URLs, runtime configs or account exports.

Keep this project independent of gateway internals. Its only network operation for detection is an ordinary `POST /responses` under the configured API base URL. Account mutation, administrator credentials and automatic suspension are outside scope.

Changes to scoring or the reference bank should pin their source commit, preserve licenses, update checksums, and explain what was actually measured. Relative scores must not be presented as verified model identity or calibrated real-world accuracy.

For a pull request, describe the problem, resulting behavior, tests and limitations. Contributions use the MIT license; third-party notices must remain intact. Bug reports should contain a commit, runtime version and mock/redacted reproduction. Use the private security reporting route for vulnerabilities.
