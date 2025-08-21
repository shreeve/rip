<img src="/logo.png" style="width:50px" /> <br>

# Rip Schema - Development Roadmap

## 🎯 Current Status

**Version**: 0.1.0 (Database Schema Generation)
**Status**: Production-ready for database schemas, validation coming soon

### ✅ Completed Features

- **Core DSL**
  - [x] Table definitions with `@table`
  - [x] All SQLite column types
  - [x] Required fields with `!` suffix
  - [x] Default values (direct and array notation)
  - [x] Type-based parameter detection
  - [x] Named parameters support
  - [x] Index definitions (single, composite, unique)
  - [x] Timestamps helper

- **Database Integration**
  - [x] Drizzle ORM table generation
  - [x] SQLite compatibility
  - [x] `db:push` command
  - [x] `db:drop` command
  - [x] SQL generation with proper defaults

- **Column Types**
  - [x] Basic: string, text, integer, bigint, boolean
  - [x] Numeric: decimal, float, double
  - [x] Temporal: date, time, timestamp, datetime
  - [x] Special: email, json, binary
  - [x] Flexible size/precision parameters

## 🚧 In Progress

### Zod Validation Generation (v0.2.0)
- [ ] Basic Zod schema generation from DSL
- [ ] Primitive type validations
- [ ] String constraints (min, max, regex, email)
- [ ] Number constraints (int, positive, range)
- [ ] Optional/required field handling
- [ ] Default value support

## 📋 Planned Features

### Phase 1: Core Validation (v0.2.x)
- [ ] Generate TypeScript validation files
- [ ] Export both table and validation schemas
- [ ] Basic refinements support
- [ ] Custom error messages
- [ ] Enum validation
- [ ] Array/JSON field validation

### Phase 2: Advanced Validation (v0.3.x)
- [ ] Complex refinements (cross-field validation)
- [ ] Async validation support
- [ ] Transform functions
- [ ] Union types
- [ ] Discriminated unions
- [ ] Nested object validation

### Phase 3: Migration System (v0.4.x)
- [ ] `db:generate` - Generate migration files
- [ ] `db:migrate` - Run migrations
- [ ] `db:rollback` - Rollback migrations
- [ ] Migration history tracking
- [ ] Schema diffing
- [ ] Safe column renames/deletes

### Phase 4: Advanced Features (v0.5.x)
- [ ] Multi-database support (PostgreSQL, MySQL)
- [ ] Relationships/associations
- [ ] Computed columns
- [ ] Database views
- [ ] Triggers
- [ ] Full-text search indexes

### Phase 5: Developer Experience (v0.6.x)
- [ ] Schema visualization
- [ ] Auto-generated documentation
- [ ] VS Code extension
- [ ] Schema linting
- [ ] Performance optimizations
- [ ] Plugin system

## 💡 Future Ideas (Backlog)

- **GraphQL Integration** - Auto-generate GraphQL schemas
- **OpenAPI/Swagger** - Generate API documentation
- **Prisma Compatibility** - Import/export Prisma schemas
- **Schema Versioning** - Track schema changes over time
- **Test Data Generation** - Use Faker.js with schema constraints
- **Runtime Type Guards** - Generate type guard functions
- **Form Generation** - React Hook Form schemas
- **Admin Panel** - Auto-generate CRUD interfaces

## 🐛 Known Issues

1. **Import paths** - Need to handle monorepo imports better
2. **Error messages** - Some Drizzle errors are cryptic
3. **Large schemas** - Performance with 100+ tables
4. **Circular references** - Not yet supported

## 📝 Design Decisions

### Why Generate Zod Instead of Custom Validation?
- **Ecosystem compatibility** - Works with existing tools
- **Battle-tested** - Zod has years of edge cases solved
- **Maintenance** - We focus on DSL, not validation engine
- **Type inference** - Zod's TypeScript integration is excellent

### Why CoffeeScript/Rip DSL?
- **Conciseness** - 50% less code than TypeScript
- **Readability** - Looks like configuration, not code
- **Flexibility** - Type-based parameters feel natural
- **Rails-inspired** - Familiar to Ruby developers

## 🤝 Contributing

Areas where we need help:
1. **Database Adapters** - PostgreSQL, MySQL support
2. **Validation Rules** - More built-in validators
3. **Documentation** - Examples and tutorials
4. **Testing** - Edge cases and performance
5. **Integrations** - Framework-specific adapters

## 📅 Release Timeline

- **v0.2.0** - Q1 2024 - Zod validation generation
- **v0.3.0** - Q2 2024 - Advanced validation features
- **v0.4.0** - Q3 2024 - Migration system
- **v0.5.0** - Q4 2024 - Multi-database support

---

Last updated: December 2024