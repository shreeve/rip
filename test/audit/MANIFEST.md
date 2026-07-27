# M3 manifest — production ownership for the corpus rewrite

The decision record the grammar gate joins against: which corpus file owns each grammar construct's productions. The gate (`bun run audit --grammar`) reads this file when present and groups its uncovered report by OWNING FILE instead of by construct — the measurement is untouched; only the grouping key changes. Claim lists are therefore always live: a wave agent's outstanding productions are its file's rows in the gate's output, and nothing derived is stored here to go stale. Constructs and productions this file does not allocate report LOUDLY as unallocated — a new dark construct (a grammar change) demands an explicit ownership decision, never a silent default. Edited only when a judgment changes; deleted when the corpus rewrite completes.

Allocation principles: a production belongs to the construct it CARRIES, not its left-hand side's family (`Expression → Gate` is reactive's, `Invocation → SUPER Arguments` is classes'); the dependency ladder breaks ties. The Overrides table records exactly these carried-construct exceptions; everything else follows its construct's row.

## Constructs

| construct                | file            |
| ------------------------ | --------------- |
| String                   | 01-basics       |
| Interpolations           | 01-basics       |
| InterpolationChunk       | 01-basics       |
| Regex                    | 01-basics       |
| This                     | 01-basics       |
| ThisProperty             | 01-basics       |
| DoIife                   | 01-basics       |
| Operation                | 02-operations   |
| Invocation               | 02-operations   |
| SimpleArgs               | 05-conditionals |
| ArgElision               | 03-collections  |
| ArgElisionList           | 03-collections  |
| Object                   | 03-collections  |
| Array                    | 03-collections  |
| Elisions                 | 03-collections  |
| Elision                  | 03-collections  |
| OptElisions              | 03-collections  |
| Range                    | 03-collections  |
| RangeDots                | 03-collections  |
| Slice                    | 03-collections  |
| PickList                 | 03-collections  |
| PickItem                 | 03-collections  |
| PickKey                  | 03-collections  |
| ObjSpreadExpr            | 03-collections  |
| Assign                   | 04-assignments  |
| AssignList               | 04-assignments  |
| SimpleAssignable         | 04-assignments  |
| ObjAssignable            | 04-assignments  |
| SimpleObjAssignable      | 04-assignments  |
| AssignObj                | 04-assignments  |
| ObjRestValue             | 04-assignments  |
| If                       | 05-conditionals |
| IfBlock                  | 05-conditionals |
| IfElseTail               | 05-conditionals |
| UnlessBlock              | 05-conditionals |
| Switch                   | 05-conditionals |
| Cases                    | 05-conditionals |
| When                     | 05-conditionals |
| For                      | 06-loops        |
| ForVariables             | 06-loops        |
| ForValue                 | 06-loops        |
| While                    | 06-loops        |
| Loop                     | 06-loops        |
| Try                      | 07-exceptions   |
| Catch                    | 07-exceptions   |
| Throw                    | 07-exceptions   |
| Def                      | 08-functions    |
| Code                     | 08-functions    |
| ArrowKind                | 08-functions    |
| ParamList                | 08-functions    |
| OptParams                | 08-functions    |
| Param                    | 08-functions    |
| ParamVar                 | 08-functions    |
| TypedParamVar            | 08-functions    |
| Return                   | 08-functions    |
| Class                    | 09-classes      |
| ClassName                | 09-classes      |
| Super                    | 09-classes      |
| NewSpine                 | 09-classes      |
| NewValue                 | 09-classes      |
| NewCall                  | 09-classes      |
| Import                   | 10-modules      |
| Export                   | 10-modules      |
| ExportAssign             | 10-modules      |
| ImportSpecifierList      | 10-modules      |
| ImportSpecifier          | 10-modules      |
| ImportDefaultSpecifier   | 10-modules      |
| ImportNamespaceSpecifier | 10-modules      |
| ExportSpecifierList      | 10-modules      |
| ExportSpecifier          | 10-modules      |
| Enum                     | 11-types        |
| TypeDecl                 | 11-types        |
| ReactiveAssign           | 12-reactive     |
| ComputedAssign           | 12-reactive     |
| Readonly                 | 12-reactive     |
| Effect                   | 12-reactive     |
| Gate                     | 13-components   |
| Component                | 13-components   |
| ComponentBlock           | 13-components   |
| ComponentLine            | 13-components   |
| ComponentBody            | 13-components   |
| Render                   | 13-components   |
| Schema                   | 14-schema       |

## Overrides

The largest block is the export-of-X family: an `Export`/`ExportAssign` production whose right-hand side is another file's construct sits with that file, because covering it means writing that construct — `export count := 0` is reactive authoring, and the reactive rulings (RULINGS.md) gate 12-reactive, not 10-modules. 10-modules keeps the frames any expression can fill (default exports, specifier lists, re-exports, plain `ExportAssign`).

| production                                     | file           | why                                       |
| ---------------------------------------------- | -------------- | ----------------------------------------- |
| `Expression → Gate`                            | 13-components  | carries a gate construct — a gate is emitter-rejected outside a direct component-body line, so covering it means writing a component |
| `Expression → ReactiveAssign`                  | 12-reactive    | carries a reactive construct              |
| `Expression → ComputedAssign`                  | 12-reactive    | carries a reactive construct              |
| `Expression → Readonly`                        | 12-reactive    | carries a reactive construct              |
| `Expression → Effect`                          | 12-reactive    | carries a reactive construct              |
| `Expression → Try`                             | 07-exceptions  | carries an exception construct            |
| `Expression → While`                           | 06-loops       | carries a loop construct                  |
| `Expression → Throw`                           | 07-exceptions  | carries an exception construct            |
| `Expression → Class`                           | 09-classes     | carries a class construct                 |
| `Expression → Def`                             | 08-functions   | carries a function construct              |
| `Expression → Schema`                          | 14-schema      | carries a schema construct                |
| `Value → Range`                                | 03-collections | carries a range construct                 |
| `Value → Super`                                | 09-classes     | carries a super construct                 |
| `Statement → Enum`                             | 11-types       | carries an enum construct                 |
| `Statement → Import`                           | 10-modules     | carries a module construct                |
| `Statement → Export`                           | 10-modules     | carries a module construct                |
| `Invocation → SUPER Arguments`                 | 09-classes     | carries a super construct                 |
| `Invocation → DYNAMIC_IMPORT Arguments`        | 10-modules     | carries a module construct                |
| `Invocation → DYNAMIC_IMPORT DAMMIT Arguments` | 10-modules     | carries a module construct                |
| `Export → EXPORT Class`                        | 09-classes     | export-of-X: carries a class construct    |
| `Export → EXPORT Def`                          | 08-functions   | export-of-X: carries a function construct |
| `Export → EXPORT Enum`                         | 11-types       | export-of-X: carries an enum construct    |
| `Export → EXPORT ReactiveAssign`               | 12-reactive    | export-of-X: carries a reactive construct |
| `Export → EXPORT ComputedAssign`               | 12-reactive    | export-of-X: carries a reactive construct |
| `Export → EXPORT Readonly`                     | 12-reactive    | export-of-X: carries a reactive construct |
| `Export → EXPORT Effect`                       | 12-reactive    | export-of-X: carries a reactive construct |
| `ExportAssign → Identifier TYPE REACTIVE_ASSIGN Expression` | 12-reactive | export-of-X: annotated reactive, exported |
| `ExportAssign → Identifier TYPE REACTIVE_ASSIGN TERMINATOR Expression` | 12-reactive | export-of-X: annotated reactive, exported |
| `ExportAssign → Identifier TYPE REACTIVE_ASSIGN INDENT Expression OUTDENT` | 12-reactive | export-of-X: annotated reactive, exported |
| `ExportAssign → Identifier TYPE COMPUTED_ASSIGN Expression` | 12-reactive | export-of-X: annotated computed, exported |
| `ExportAssign → Identifier TYPE COMPUTED_ASSIGN TERMINATOR Expression` | 12-reactive | export-of-X: annotated computed, exported |
| `ExportAssign → Identifier TYPE COMPUTED_ASSIGN Block` | 12-reactive | export-of-X: annotated computed, exported |
| `ExportAssign → Identifier TYPE READONLY_ASSIGN Expression` | 12-reactive | export-of-X: annotated readonly, exported |
| `ExportAssign → Identifier TYPE READONLY_ASSIGN TERMINATOR Expression` | 12-reactive | export-of-X: annotated readonly, exported |
| `ExportAssign → Identifier TYPE READONLY_ASSIGN INDENT Expression OUTDENT` | 12-reactive | export-of-X: annotated readonly, exported |
| `ExportAssign → Identifier TYPE EFFECT Expression` | 12-reactive | export-of-X: annotated effect, exported |
| `ExportAssign → Identifier TYPE EFFECT TERMINATOR Expression` | 12-reactive | export-of-X: annotated effect, exported |
| `ExportAssign → Identifier TYPE EFFECT Block` | 12-reactive | export-of-X: annotated effect, exported |
| `Assign → Assignable TYPE_PARAMS = Expression` | 13-components  | its sole carrier is a generic component target (`X<T> = component` — the lexer mints TYPE_PARAMS only there) |
| `ExportAssign → Identifier TYPE_PARAMS = Expression` | 13-components  | same sole carrier, exported spelling |

## Parked

| production                                | until                                                |
| ----------------------------------------- | ---------------------------------------------------- |
| `Operation → Expression MATCH Expression` | the open match-operator finding closes (FINDINGS.md) |
| `SimpleAssignable → Subjectable INDEX_START Expression , Expression INDEX_END` | the open match-operator finding closes (FINDINGS.md) — the regex-index spelling shares its root |
| `Catch → CATCH Object Block`              | the open pattern-catch finding closes (FINDINGS.md)  |
| `Catch → CATCH Array Block`               | the open pattern-catch finding closes (FINDINGS.md)  |
| `NewSpine → NewSpine ?. Property`         | the open new-on-optional-chain finding closes (FINDINGS.md) — the emission cannot parse as JS |
| `NewSpine → NewSpine TEMPLATE_TAG String` | the open new-on-tagged-template finding closes (FINDINGS.md) — the emission leaks the sexpr head |

Productions no fixture can or should ever reduce (lexically unreachable spellings, banned-by-design error carriers) are not parked here — they are excluded from the denominator by the gate itself, whose exclusion table in runner.js is part of the measurement and outlives this file.
