# Rollback

1. Stop traffic to the new release at the load balancer or proxy.
2. Redeploy the previous backend and web image tags.
3. If a migration was applied and must be reverted, restore the latest verified backup:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/bioflow ./infrastructure/restore-postgres.sh backups/file.sql
```

4. Run health checks:

```bash
curl -f https://bioflow.example.com/api/v1/health
```

5. Re-enable traffic after health and smoke checks pass.
