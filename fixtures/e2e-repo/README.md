# Demo Upload Service

A minimal Express-based upload service used for TPDC mutation testing.

## Endpoints

- `POST /api/upload` — Upload a file (accepts `filename` and `data` in JSON body)
- `GET /api/uploads` — List uploaded files (placeholder)
- `GET /api/health` — Health check

## Running

```bash
npm install
npm start
```
