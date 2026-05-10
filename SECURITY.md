# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately instead of opening a public issue.

Include:

- affected version or commit
- operating system
- reproduction steps
- expected and actual impact
- relevant logs with secrets removed

## Scope

Security-sensitive areas include:

- local file access and path validation
- Markdown HTML sanitization
- exported HTML/PDF/DOCX content
- Electron main/preload IPC boundaries
- remote DOCX service configuration

## Secrets

Do not include private documents, API keys, tokens, cookies, or internal URLs in bug reports.
