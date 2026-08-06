# Business Brain persistence

Business knowledge is stored as immutable, owner-scoped records in PocketBase.

Lifecycle:

1. New knowledge is created as `observed`.
2. Promotion validates the canonical Business Brain rules.
3. Each promotion creates a new record rather than mutating the prior version.
4. The prior record is linked through `superseded_by_id`; the replacement points back through `supersedes_id`.
5. Contradicted knowledge cannot be promoted.
6. Durable `approved` knowledge requires explicit owner approval.
7. Queries return only the owner's current, non-superseded records and may be filtered by stage or usage scope.

Deployment setup:

```text
POST /api/setup/business-knowledge
```

This setup endpoint creates or patches the `business_knowledge` collection, owner-only rules, and retrieval indexes.
