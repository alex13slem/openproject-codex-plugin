# Security policy

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in a public issue. Use
GitHub's private vulnerability reporting feature for this repository instead.

Include the affected version or commit, reproduction steps, potential impact,
and any suggested mitigation. Remove API tokens, private OpenProject URLs, and
customer data from the report.

## Credential safety

The plugin reads an OpenProject API token from a local environment file. Keep
that file outside the repository with permissions limited to your user. If a
token is exposed, revoke it in OpenProject immediately and issue a replacement.
