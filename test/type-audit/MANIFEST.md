# M3 manifest — production ownership for the corpus rewrite

The decision record the grammar gate joins against: which corpus file owns each grammar construct's productions. The gate (`bun run type-audit --grammar`) reads this file when present and groups its uncovered report by OWNING FILE instead of by construct — the measurement is untouched; only the grouping key changes. Claim lists are therefore always live: a wave agent's outstanding productions are its file's rows in the gate's output, and nothing derived is stored here to go stale. Constructs and productions this file does not allocate report LOUDLY as unallocated — a new dark construct (a grammar change) demands an explicit ownership decision, never a silent default. Edited only when a judgment changes; deleted when the corpus rewrite completes.

Allocation principles: a production belongs to the construct it CARRIES, not its left-hand side's family (`Expression → Gate` is reactive's, `Invocation → SUPER Arguments` is classes'); the dependency ladder breaks ties. The Overrides table records exactly these carried-construct exceptions; everything else follows its construct's row.

## Constructs

| construct                | file            |
| ------------------------ | --------------- |
| Operation                | 21-operations   |
| Invocation               | 21-operations   |
| SimpleArgs               | 24-conditionals |
| ArgElision               | 22-collections  |
| ArgElisionList           | 22-collections  |
| Object                   | 22-collections  |
| Array                    | 22-collections  |
| Elisions                 | 22-collections  |
| Elision                  | 22-collections  |
| OptElisions              | 22-collections  |
| Range                    | 22-collections  |
| RangeDots                | 22-collections  |
| Slice                    | 22-collections  |
| PickList                 | 22-collections  |
| PickItem                 | 22-collections  |
| PickKey                  | 22-collections  |
| ObjSpreadExpr            | 22-collections  |
| Assign                   | 23-assignments  |
| SimpleAssignable         | 23-assignments  |
| ObjAssignable            | 23-assignments  |
| AssignObj                | 23-assignments  |
| ObjRestValue             | 23-assignments  |
| If                       | 24-conditionals |
| UnlessBlock              | 24-conditionals |
| Switch                   | 24-conditionals |
| For                      | 25-loops        |
| ForVariables             | 25-loops        |
| While                    | 25-loops        |
| Loop                     | 25-loops        |
| Try                      | 26-exceptions   |
| Catch                    | 26-exceptions   |
| Throw                    | 26-exceptions   |
| Def                      | 27-functions    |
| ParamList                | 27-functions    |
| OptParams                | 27-functions    |
| Param                    | 27-functions    |
| ParamVar                 | 27-functions    |
| TypedParamVar            | 27-functions    |
| Return                   | 27-functions    |
| Class                    | 28-classes      |
| ClassName                | 28-classes      |
| Super                    | 28-classes      |
| NewSpine                 | 28-classes      |
| NewValue                 | 28-classes      |
| Import                   | 29-modules      |
| Export                   | 29-modules      |
| ExportAssign             | 29-modules      |
| ImportSpecifierList      | 29-modules      |
| ImportSpecifier          | 29-modules      |
| ImportDefaultSpecifier   | 29-modules      |
| ImportNamespaceSpecifier | 29-modules      |
| ExportSpecifierList      | 29-modules      |
| ExportSpecifier          | 29-modules      |
| Enum                     | 30-types        |
| ReactiveAssign           | 31-reactive     |
| ComputedAssign           | 31-reactive     |
| Readonly                 | 31-reactive     |
| Effect                   | 31-reactive     |
| Gate                     | 31-reactive     |
| ComponentLine            | 32-components   |
| ComponentBody            | 32-components   |

## Overrides

| production                                     | file           | why                                       |
| ---------------------------------------------- | -------------- | ----------------------------------------- |
| `Expression → Gate`                            | 31-reactive    | carries a reactive construct              |
| `Expression → Try`                             | 26-exceptions  | carries an exception construct            |
| `Expression → While`                           | 25-loops       | carries a loop construct                  |
| `Expression → Throw`                           | 26-exceptions  | carries an exception construct            |
| `Expression → Class`                           | 28-classes     | carries a class construct                 |
| `Value → Range`                                | 22-collections | carries a range construct                 |
| `Value → Super`                                | 28-classes     | carries a super construct                 |
| `Statement → Enum`                             | 30-types       | carries an enum construct                 |
| `Root → ε`                                     | 35-edges       | the empty program — an edge, not a family |
| `Invocation → SUPER Arguments`                 | 28-classes     | carries a super construct                 |
| `Invocation → DYNAMIC_IMPORT Arguments`        | 29-modules     | carries a module construct                |
| `Invocation → DYNAMIC_IMPORT DAMMIT Arguments` | 29-modules     | carries a module construct                |

## Parked

| production                                | until                                                |
| ----------------------------------------- | ---------------------------------------------------- |
| `Operation → Expression MATCH Expression` | the open match-operator finding closes (FINDINGS.md) |
