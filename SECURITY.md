# Security policy

This repository is the specification. A weakness can be in the specification itself (a rule that, followed correctly, leaves implementations open to attack) or in an implementation. Both are welcome.

## Reporting

- E-mail **security@openbrandexchange.com**, or open a [private security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on the affected repository.
- **Never** report a vulnerability in a public issue, pull request or discussion.
- Include: what is affected (spec section, repository and commit or version), what an attacker can do, the steps to reproduce, and whether you want to be credited.
- Test only against portals you run yourself (for example `obx-conformance mock` or a local node). Do not test against other people's portals, and do not access, change or keep data that is not yours.

## What happens next

| | Target |
|---|---|
| acknowledgement of your report | within **3 working days** |
| first assessment (valid or not, severity) | within **10 working days** |
| fix or mitigation for a critical or high issue | within **30 days** of the assessment |
| fix for medium and low issues | in the next planned release |

These are the targets of a small volunteer project; we will tell you when we cannot meet one. We keep you informed until the issue is closed.

## Disclosure

We follow coordinated disclosure: we publish an advisory once a fix or mitigation is available, at the latest **90 days** after your report unless we agree otherwise with you. A weakness in the specification is fixed in a patch or minor release and listed under "Security" in the [changelog](CHANGELOG.md); every implementation listed in [docs/implementations.md](docs/implementations.md) is told before publication. We credit reporters who want to be named.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes |
| older drafts | no |

The security requirements for implementations are in [docs/security.md](docs/security.md).
