---
paths: []
---

# Security Review Triggers

Always request a security review of the change when the diff touches any of:

- Authentication or authorization code
- User input handling (forms, URL params, request body)
- Database queries or migrations
- File system operations
- External API calls
- Cryptographic operations
- Payment or financial code
- Supabase RLS policies

When in doubt: request the review. False positives are cheap,
missed vulnerabilities are not.