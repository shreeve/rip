<img src="/docs/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip Schema - Changelog

All notable changes to rip-schema will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Zod validation generation (experimental)
- Example files for Zod output
- Roadmap documentation

## [0.1.0] - 2024-12-28

### Added
- Initial release with database schema generation
- ActiveRecord-inspired DSL for schema definition
- Full SQLite column type support
- Drizzle ORM integration
- CLI with `db:push` and `db:drop` commands
- Type-based parameter detection
- Named parameter support
- Index management (single, composite, unique)
- Default value support (direct and array notation)
- Required fields with `!` suffix
- JSON field support with automatic stringification
- Binary data type support
- Comprehensive test coverage via example schemas

### Schema DSL Features
- `@table` for table definitions
- `@string`, `@text` for text fields
- `@integer`, `@bigint` for whole numbers
- `@decimal`, `@float`, `@double` for decimals
- `@boolean` for true/false
- `@date`, `@time`, `@timestamp`, `@datetime` for temporal data
- `@email` for validated email fields
- `@json` for structured data
- `@binary` for blob storage
- `@timestamps()` helper for created_at/updated_at
- `@index` for database indexes

### Examples
- Blog schema (users, posts, comments)
- Medical system schema (comprehensive test)
- Legal system schema (integrated with API)

### Developer Experience
- Clean CoffeeScript/Rip syntax
- Minimal boilerplate
- Intuitive parameter ordering
- Helpful error messages
- Hot reload support

## [0.0.1] - 2024-12-27

### Added
- Project initialization
- Basic concept exploration
- Name decided: rip-schema (formerly ActiveRip, rip-model)