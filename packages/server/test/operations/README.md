# operations

Operational-state shape:

- `hold` fences activation and publication;
- `release` activates one coherent API/App snapshot;
- `migrate` runs only behind the maintenance barrier;
- interruption leaves a durable diagnosis;
- `recover` fixes forward before admission resumes.

Database setup is an explicit operation, never a worker-import side effect.
