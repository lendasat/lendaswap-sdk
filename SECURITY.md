# Security Policy

Satora takes the security of our systems and user funds seriously. We
appreciate the security community's help in keeping the Satora SDK safe.

This repository follows the policy published at
<https://satora.io/security>.

## Reporting a Vulnerability

If you discover a security vulnerability in the Satora SDK, please report it to
us privately so we can address it before public disclosure.

**Do not report security issues via public GitHub issues, Telegram, or
Twitter.**

- Email: <security@satora.io>
- PGP key: <https://satora.io/.well-known/security.asc>

Please include enough detail for us to reproduce and understand the issue, such
as affected package/version, environment, proof of concept, impact, and any
known mitigations.

## Scope

For this repository, vulnerabilities affecting Satora SDK packages are in scope,
including:

- TypeScript SDK packages
- Rust SDK crate
- .NET SDK package and native bindings
- SDK examples, build scripts, and generated API bindings when they affect SDK
  users

The broader Satora security scope is listed at <https://satora.io/security>.

## Disclosure Timeline

We aim to respond to all vulnerability reports within 24 hours and will work
with you to understand the scope and severity of the issue. Our typical
disclosure timeline is:

1. Acknowledgment: we confirm receipt within 24 hours.
2. Triage: we assess the report and determine severity within 3 business days.
3. Resolution: we develop and test a fix. Timeline depends on severity.
4. Release: we deploy or publish the fix and notify you when it is live.
5. Disclosure: we coordinate public disclosure after the fix is deployed.

## Safe Harbor

We consider security research conducted in good faith to be protected under safe
harbor. This means:

- You will not face legal action from Satora for vulnerability research
  conducted in accordance with this policy.
- We will not forward your personal data to law enforcement unless you violate
  applicable law.
- We ask that you make a good faith effort to avoid privacy violations, data
  destruction, and interruption or degradation of our services.
- Please only interact with accounts you own or have explicit permission to
  test.

## Out of Scope

The following are considered out of scope:

- Rate limiting or brute force protection bypasses
- Missing security headers that do not impact security directly
- Self-XSS or issues requiring unlikely user interactions
- Social engineering attacks
- Physical attacks or physical security issues
- Presence of autofill / password manager attributes in forms
- TLS/SSL configuration issues
- Email SPF/DKIM/DMARC configuration issues
