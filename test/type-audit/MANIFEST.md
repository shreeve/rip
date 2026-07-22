# M3 manifest — the dark-production allocation, per corpus file

Generated from the grammar gate (`bun run type-audit --grammar --v`) at commit b771a24, after 20-basics landed. Each production below is claimed by EXACTLY ONE file: the wave agents author against these lists, and the integration check is arithmetic — the gate's coverage number must rise by each file's count, and any production still dark after a wave was missed by the file that owns it here. Bridge productions (`Expression → Gate` and kin) are allocated to the construct they carry, not their left-hand side's family. This file is WORKING DATA for the M3 waves: regenerate it after each wave lands (a landed file's claims disappear from the gate's output), and delete it when the corpus rewrite completes.

## 21-operations — 7 productions

- `ArgElision → Elisions Arg`
- `ArgElisionList → ArgElisionList OptElisions INDENT ArgElisionList OptElisions OUTDENT`
- `Invocation → DYNAMIC_IMPORT Arguments`
- `Invocation → DYNAMIC_IMPORT DAMMIT Arguments`
- `Invocation → SUPER Arguments`
- `Operation → Expression MATCH Expression` — PARKED: blocked on the open match-operator finding (FINDINGS.md); stays dark until it closes
- `SimpleArgs → SimpleArgs , Expression`

## 22-collections — 43 productions

- `Array → [ Elisions ]`
- `Elision → ,`
- `Elision → Elision TERMINATOR`
- `Elisions → Elision`
- `Elisions → Elisions Elision`
- `ObjSpreadExpr → DYNAMIC_IMPORT Arguments`
- `ObjSpreadExpr → ObjSpreadExpr . Property`
- `ObjSpreadExpr → ObjSpreadExpr ?. Property`
- `ObjSpreadExpr → ObjSpreadExpr Arguments`
- `ObjSpreadExpr → ObjSpreadExpr DAMMIT`
- `ObjSpreadExpr → ObjSpreadExpr INDEX_START Expression INDEX_END`
- `ObjSpreadExpr → ObjSpreadExpr INDEX_START INDENT Expression OUTDENT INDEX_END`
- `ObjSpreadExpr → ObjSpreadExpr OPTPICK_START INDENT PickList OptComma OUTDENT PICK_END`
- `ObjSpreadExpr → ObjSpreadExpr OPTPICK_START PickList OptComma PICK_END`
- `ObjSpreadExpr → ObjSpreadExpr PICK_START INDENT PickList OptComma OUTDENT PICK_END`
- `ObjSpreadExpr → ObjSpreadExpr PICK_START PickList OptComma PICK_END`
- `ObjSpreadExpr → Object`
- `ObjSpreadExpr → Parenthetical`
- `ObjSpreadExpr → SUPER Arguments`
- `ObjSpreadExpr → SimpleObjAssignable`
- `ObjSpreadExpr → SimpleObjAssignable Arguments`
- `ObjSpreadExpr → Super`
- `ObjSpreadExpr → This`
- `Object → MAP_START { AssignList OptComma }`
- `OptElisions → , Elisions`
- `PickItem → PickKey`
- `PickItem → PickKey : PickKey`
- `PickItem → PickKey : PickKey = Expression`
- `PickItem → PickKey = Expression`
- `PickKey → Identifier`
- `PickKey → Property`
- `PickList → PickItem`
- `PickList → PickList , PickItem`
- `PickList → PickList OptComma INDENT PickList OptComma OUTDENT`
- `PickList → PickList OptComma TERMINATOR PickItem`
- `Range → [ Expression RangeDots Expression ]`
- `RangeDots → ..`
- `RangeDots → ...`
- `Slice → Expression RangeDots`
- `Slice → Expression RangeDots Expression`
- `Slice → RangeDots`
- `Slice → RangeDots Expression`
- `Value → Range`

## 23-assignments — 40 productions

- `Assign → Assignable = TERMINATOR Expression`
- `Assign → Assignable OPT_MARKER = Expression`
- `Assign → Assignable OPT_MARKER = INDENT Expression OUTDENT`
- `Assign → Assignable OPT_MARKER = TERMINATOR Expression`
- `Assign → Assignable OPT_MARKER TYPE = Expression`
- `Assign → Assignable OPT_MARKER TYPE = INDENT Expression OUTDENT`
- `Assign → Assignable OPT_MARKER TYPE = TERMINATOR Expression`
- `Assign → Assignable TYPE = TERMINATOR Expression`
- `Assign → Assignable TYPE_PARAMS = Expression`
- `Assign → Assignable TYPE_PARAMS = INDENT Expression OUTDENT`
- `Assign → Assignable TYPE_PARAMS = TERMINATOR Expression`
- `Assign → Identifier VOID_MARKER = Expression`
- `Assign → Identifier VOID_MARKER = INDENT Expression OUTDENT`
- `Assign → Identifier VOID_MARKER = TERMINATOR Expression`
- `Assign → MERGE_ASSIGN SimpleAssignable = Expression`
- `Assign → STRING = Expression`
- `Assign → STRING TYPE = Expression`
- `Assign → SimpleAssignable COMPOUND_ASSIGN Expression`
- `Assign → SimpleAssignable COMPOUND_ASSIGN INDENT Expression OUTDENT`
- `Assign → SimpleAssignable COMPOUND_ASSIGN TERMINATOR Expression`
- `Assign → SimpleAssignable METHOD_ASSIGN Expression`
- `AssignObj → ObjAssignable : INDENT Expression OUTDENT`
- `AssignObj → Regex : Expression`
- `AssignObj → SimpleObjAssignable = INDENT Expression OUTDENT`
- `AssignObj → SimpleObjAssignable VOID_MARKER : Expression`
- `AssignObj → SimpleObjAssignable VOID_MARKER : INDENT Expression OUTDENT`
- `ObjAssignable → @ [ Expression ]`
- `ObjAssignable → [ Expression ]`
- `ObjRestValue → ... ObjSpreadExpr`
- `SimpleAssignable → IMPORT_META . Property`
- `SimpleAssignable → NEW_TARGET . Property`
- `SimpleAssignable → Subjectable ES6_OPTIONAL_INDEX INDEX_START INDENT Expression OUTDENT INDEX_END`
- `SimpleAssignable → Subjectable INDEX_START Expression , Expression INDEX_END`
- `SimpleAssignable → Subjectable INDEX_START INDENT Expression OUTDENT INDEX_END`
- `SimpleAssignable → Subjectable INDEX_START INDENT Slice OUTDENT INDEX_END`
- `SimpleAssignable → Subjectable INDEX_START Slice INDEX_END`
- `SimpleAssignable → Subjectable OPTPICK_START INDENT PickList OptComma OUTDENT PICK_END`
- `SimpleAssignable → Subjectable OPTPICK_START PickList OptComma PICK_END`
- `SimpleAssignable → Subjectable PICK_START INDENT PickList OptComma OUTDENT PICK_END`
- `SimpleAssignable → Subjectable PICK_START PickList OptComma PICK_END`

## 24-conditionals — 10 productions

- `If → Expression POST_IF Expression`
- `If → Expression POST_IF Expression ELSE Expression`
- `If → Expression POST_IF Expression ELSE INDENT Expression OUTDENT`
- `If → Expression POST_UNLESS Expression`
- `If → Statement POST_IF Expression`
- `If → Statement POST_UNLESS Expression`
- `Switch → SWITCH Expression INDENT Cases ELSE Block OUTDENT`
- `Switch → SWITCH INDENT Cases ELSE Block OUTDENT`
- `Switch → SWITCH INDENT Cases OUTDENT`
- `UnlessBlock → UNLESS Expression Block ELSE Block`

## 25-loops — 48 productions

- `Expression → While`
- `For → Expression FOR AWAIT ForVariables FORAS Expression`
- `For → Expression FOR AWAIT ForVariables FORAS Expression WHEN Expression`
- `For → Expression FOR ForVariables FORAS Expression`
- `For → Expression FOR ForVariables FORAS Expression WHEN Expression`
- `For → Expression FOR ForVariables FORASAWAIT Expression`
- `For → Expression FOR ForVariables FORASAWAIT Expression WHEN Expression`
- `For → Expression FOR ForVariables FORIN Expression`
- `For → Expression FOR ForVariables FORIN Expression BY Expression`
- `For → Expression FOR ForVariables FORIN Expression BY Expression WHEN Expression`
- `For → Expression FOR ForVariables FORIN Expression WHEN Expression`
- `For → Expression FOR ForVariables FORIN Expression WHEN Expression BY Expression`
- `For → Expression FOR ForVariables FOROF Expression`
- `For → Expression FOR ForVariables FOROF Expression WHEN Expression`
- `For → Expression FOR OWN ForVariables FOROF Expression`
- `For → Expression FOR OWN ForVariables FOROF Expression WHEN Expression`
- `For → FOR AWAIT ForVariables FORAS Expression Block`
- `For → FOR AWAIT ForVariables FORAS Expression WHEN Expression Block`
- `For → FOR ForVariables FORAS Expression Block`
- `For → FOR ForVariables FORAS Expression WHEN Expression Block`
- `For → FOR ForVariables FORASAWAIT Expression Block`
- `For → FOR ForVariables FORASAWAIT Expression WHEN Expression Block`
- `For → FOR ForVariables FORIN Expression BY Expression Block`
- `For → FOR ForVariables FORIN Expression BY Expression WHEN Expression Block`
- `For → FOR ForVariables FORIN Expression WHEN Expression BY Expression Block`
- `For → FOR ForVariables FORIN Expression WHEN Expression Block`
- `For → FOR ForVariables FOROF Expression Block`
- `For → FOR ForVariables FOROF Expression WHEN Expression Block`
- `For → FOR OWN ForVariables FOROF Expression Block`
- `For → FOR OWN ForVariables FOROF Expression WHEN Expression Block`
- `For → FOR Range BY Expression Block`
- `For → FOR Range Block`
- `ForVariables → ForValue , ForValue`
- `Loop → LOOP Block`
- `Loop → LOOP Expression Block`
- `While → Expression UNTIL Expression`
- `While → Expression UNTIL Expression WHEN Expression`
- `While → Expression WHILE Expression`
- `While → Expression WHILE Expression WHEN Expression`
- `While → Loop`
- `While → Statement UNTIL Expression`
- `While → Statement UNTIL Expression WHEN Expression`
- `While → Statement WHILE Expression`
- `While → Statement WHILE Expression WHEN Expression`
- `While → UNTIL Expression Block`
- `While → UNTIL Expression WHEN Expression Block`
- `While → WHILE Expression Block`
- `While → WHILE Expression WHEN Expression Block`

## 26-exceptions — 14 productions

- `Catch → CATCH Array Block`
- `Catch → CATCH Block`
- `Catch → CATCH Identifier Block`
- `Catch → CATCH Object Block`
- `Expression → Throw`
- `Expression → Try`
- `Throw → THROW Expression`
- `Throw → THROW INDENT Object OUTDENT`
- `Try → TRY Block`
- `Try → TRY Block Catch`
- `Try → TRY Block Catch FINALLY Block`
- `Try → TRY Block FINALLY Block`
- `Try → TRY Expression`
- `Try → TRY Expression Catch`

## 27-functions — 10 productions

- `Def → DEF Identifier TYPE_PARAMS OptParams Block`
- `Def → DEF Identifier VOID_MARKER OptParams TYPE Block`
- `OptParams → ε`
- `Param → ...`
- `ParamList → ParamList OptComma INDENT ParamList OptComma OUTDENT`
- `ParamList → ParamList OptComma TERMINATOR Param`
- `ParamVar → ThisProperty`
- `Return → RETURN`
- `Return → RETURN INDENT Object OUTDENT`
- `TypedParamVar → ParamVar OPT_MARKER`

## 28-classes — 28 productions

- `Class → CLASS`
- `Class → CLASS Block`
- `Class → CLASS ClassName`
- `Class → CLASS ClassName Block`
- `Class → CLASS ClassName EXTENDS Expression`
- `Class → CLASS ClassName EXTENDS Expression Block`
- `Class → CLASS EXTENDS Expression`
- `Class → CLASS EXTENDS Expression Block`
- `Class → CLASS ThisProperty Block`
- `Class → CLASS ThisProperty EXTENDS Expression Block`
- `ClassName → Identifier`
- `Expression → Class`
- `NewSpine → NewSpine . Property`
- `NewSpine → NewSpine ?. Property`
- `NewSpine → NewSpine INDEX_START Expression INDEX_END`
- `NewSpine → NewSpine TEMPLATE_TAG String`
- `NewSpine → Parenthetical`
- `NewSpine → Super`
- `NewSpine → This`
- `NewSpine → ThisProperty`
- `NewValue → NEW NewSpine`
- `NewValue → NEW NewSpine DAMMIT`
- `NewValue → NEW NewSpine DAMMIT Arguments`
- `NewValue → NEW NewValue`
- `Super → SUPER . Property`
- `Super → SUPER INDEX_START Expression INDEX_END`
- `Super → SUPER INDEX_START INDENT Expression OUTDENT INDEX_END`
- `Value → Super`

## 29-modules — 59 productions

- `Export → EXPORT Class`
- `Export → EXPORT ComputedAssign`
- `Export → EXPORT DEFAULT Expression`
- `Export → EXPORT DEFAULT INDENT Object OUTDENT`
- `Export → EXPORT EXPORT_ALL FROM String`
- `Export → EXPORT Effect`
- `Export → EXPORT Enum`
- `Export → EXPORT ReactiveAssign`
- `Export → EXPORT Readonly`
- `Export → EXPORT { ExportSpecifierList OptComma }`
- `Export → EXPORT { ExportSpecifierList OptComma } FROM String`
- `Export → EXPORT { }`
- `Export → EXPORT { } FROM String`
- `ExportAssign → Identifier = INDENT Expression OUTDENT`
- `ExportAssign → Identifier = TERMINATOR Expression`
- `ExportAssign → Identifier TYPE = Expression`
- `ExportAssign → Identifier TYPE = INDENT Expression OUTDENT`
- `ExportAssign → Identifier TYPE = TERMINATOR Expression`
- `ExportAssign → Identifier TYPE COMPUTED_ASSIGN Block`
- `ExportAssign → Identifier TYPE COMPUTED_ASSIGN Expression`
- `ExportAssign → Identifier TYPE COMPUTED_ASSIGN TERMINATOR Expression`
- `ExportAssign → Identifier TYPE EFFECT Block`
- `ExportAssign → Identifier TYPE EFFECT Expression`
- `ExportAssign → Identifier TYPE EFFECT TERMINATOR Expression`
- `ExportAssign → Identifier TYPE REACTIVE_ASSIGN Expression`
- `ExportAssign → Identifier TYPE REACTIVE_ASSIGN INDENT Expression OUTDENT`
- `ExportAssign → Identifier TYPE REACTIVE_ASSIGN TERMINATOR Expression`
- `ExportAssign → Identifier TYPE READONLY_ASSIGN Expression`
- `ExportAssign → Identifier TYPE READONLY_ASSIGN INDENT Expression OUTDENT`
- `ExportAssign → Identifier TYPE READONLY_ASSIGN TERMINATOR Expression`
- `ExportAssign → Identifier TYPE_PARAMS = INDENT Expression OUTDENT`
- `ExportAssign → Identifier TYPE_PARAMS = TERMINATOR Expression`
- `ExportAssign → Identifier VOID_MARKER = Expression`
- `ExportAssign → Identifier VOID_MARKER = INDENT Expression OUTDENT`
- `ExportAssign → Identifier VOID_MARKER = TERMINATOR Expression`
- `ExportSpecifier → DEFAULT`
- `ExportSpecifier → DEFAULT AS Identifier`
- `ExportSpecifier → Identifier`
- `ExportSpecifier → Identifier AS DEFAULT`
- `ExportSpecifier → Identifier AS Identifier`
- `ExportSpecifierList → ExportSpecifier`
- `ExportSpecifierList → ExportSpecifierList , ExportSpecifier`
- `ExportSpecifierList → ExportSpecifierList OptComma INDENT ExportSpecifierList OptComma OUTDENT`
- `ExportSpecifierList → ExportSpecifierList OptComma TERMINATOR ExportSpecifier`
- `ExportSpecifierList → INDENT ExportSpecifierList OptComma OUTDENT`
- `Import → IMPORT ImportDefaultSpecifier , ImportNamespaceSpecifier FROM String`
- `Import → IMPORT ImportDefaultSpecifier , { ImportSpecifierList OptComma } FROM String`
- `Import → IMPORT ImportDefaultSpecifier FROM String`
- `Import → IMPORT ImportNamespaceSpecifier FROM String`
- `Import → IMPORT String`
- `Import → IMPORT { } FROM String`
- `ImportDefaultSpecifier → Identifier`
- `ImportNamespaceSpecifier → IMPORT_ALL AS Identifier`
- `ImportSpecifier → DEFAULT`
- `ImportSpecifier → DEFAULT AS Identifier`
- `ImportSpecifier → Identifier AS Identifier`
- `ImportSpecifierList → INDENT ImportSpecifierList OptComma OUTDENT`
- `ImportSpecifierList → ImportSpecifierList OptComma INDENT ImportSpecifierList OptComma OUTDENT`
- `ImportSpecifierList → ImportSpecifierList OptComma TERMINATOR ImportSpecifier`

## 30-types — 2 productions

- `Enum → ENUM Identifier Block`
- `Statement → Enum`

## 31-reactive — 44 productions

- `ComputedAssign → Assignable COMPUTED_ASSIGN TERMINATOR Expression`
- `ComputedAssign → Assignable OPT_MARKER COMPUTED_ASSIGN Block`
- `ComputedAssign → Assignable OPT_MARKER COMPUTED_ASSIGN Expression`
- `ComputedAssign → Assignable OPT_MARKER COMPUTED_ASSIGN TERMINATOR Expression`
- `ComputedAssign → Assignable OPT_MARKER TYPE COMPUTED_ASSIGN Block`
- `ComputedAssign → Assignable OPT_MARKER TYPE COMPUTED_ASSIGN Expression`
- `ComputedAssign → Assignable OPT_MARKER TYPE COMPUTED_ASSIGN TERMINATOR Expression`
- `ComputedAssign → Assignable TYPE COMPUTED_ASSIGN Block`
- `ComputedAssign → Assignable TYPE COMPUTED_ASSIGN TERMINATOR Expression`
- `Effect → Assignable EFFECT Block`
- `Effect → Assignable EFFECT Expression`
- `Effect → Assignable EFFECT TERMINATOR Expression`
- `Effect → Assignable TYPE EFFECT Block`
- `Effect → Assignable TYPE EFFECT TERMINATOR Expression`
- `Effect → EFFECT Block`
- `Effect → EFFECT Expression`
- `Effect → EFFECT TERMINATOR Expression`
- `Expression → Gate`
- `Gate → Assignable GATE Value`
- `Gate → Assignable GATE Value CALL_START ArgList OptComma CALL_END`
- `Gate → Assignable GATE Value CALL_START CALL_END`
- `Gate → Assignable TYPE GATE Value`
- `Gate → Assignable TYPE GATE Value CALL_START ArgList OptComma CALL_END`
- `Gate → Assignable TYPE GATE Value CALL_START CALL_END`
- `ReactiveAssign → Assignable OPT_MARKER REACTIVE_ASSIGN Expression`
- `ReactiveAssign → Assignable OPT_MARKER REACTIVE_ASSIGN INDENT Expression OUTDENT`
- `ReactiveAssign → Assignable OPT_MARKER REACTIVE_ASSIGN TERMINATOR Expression`
- `ReactiveAssign → Assignable OPT_MARKER TYPE REACTIVE_ASSIGN INDENT Expression OUTDENT`
- `ReactiveAssign → Assignable OPT_MARKER TYPE REACTIVE_ASSIGN TERMINATOR Expression`
- `ReactiveAssign → Assignable REACTIVE_ASSIGN INDENT Expression OUTDENT`
- `ReactiveAssign → Assignable REACTIVE_ASSIGN TERMINATOR Expression`
- `ReactiveAssign → Assignable TYPE REACTIVE_ASSIGN INDENT Expression OUTDENT`
- `ReactiveAssign → Assignable TYPE REACTIVE_ASSIGN TERMINATOR Expression`
- `Readonly → Assignable OPT_MARKER READONLY_ASSIGN Expression`
- `Readonly → Assignable OPT_MARKER READONLY_ASSIGN INDENT Expression OUTDENT`
- `Readonly → Assignable OPT_MARKER READONLY_ASSIGN TERMINATOR Expression`
- `Readonly → Assignable OPT_MARKER TYPE READONLY_ASSIGN Expression`
- `Readonly → Assignable OPT_MARKER TYPE READONLY_ASSIGN INDENT Expression OUTDENT`
- `Readonly → Assignable OPT_MARKER TYPE READONLY_ASSIGN TERMINATOR Expression`
- `Readonly → Assignable READONLY_ASSIGN Expression`
- `Readonly → Assignable READONLY_ASSIGN INDENT Expression OUTDENT`
- `Readonly → Assignable READONLY_ASSIGN TERMINATOR Expression`
- `Readonly → Assignable TYPE READONLY_ASSIGN INDENT Expression OUTDENT`
- `Readonly → Assignable TYPE READONLY_ASSIGN TERMINATOR Expression`

## 32-components — 3 productions

- `ComponentBody → ComponentBody TERMINATOR`
- `ComponentLine → ACCEPT IDENTIFIER`
- `ComponentLine → OFFER Expression`

## 35-edges — 1 productions

- `Root → ε`
