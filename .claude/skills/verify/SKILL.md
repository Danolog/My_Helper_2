---
name: verify
description: Run full quality check (lint + typecheck + unit tests) before marking any task complete
---

Run these commands in sequence and report results:

```bash
pnpm check && pnpm test
```

- If all pass: confirm done
- If any fail: fix the failures before declaring the task complete

Use this before every commit and before claiming work is finished.
