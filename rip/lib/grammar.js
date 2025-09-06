// Generated from src/grammar.rip

// The grammar object that Solar expects
export const grammar = {

  // Parser options
  options: {
    debug: false
  },

  // Define operator precedence and associativity (from lowest to highest)
  operators: [
    ["left", ","],
    ["right", "=", "+=", "-=", "*=", "/=", "%="],
    ["right", "?", ":"],
    ["left", "||"],
    ["left", "&&"],
    ["left", "==", "!=", "===", "!=="],
    ["left", "<", ">", "<=", ">=", "instanceof", "in"],
    ["left", "<<", ">>", ">>>"],
    ["left", "+", "-"],
    ["left", "*", "/", "%"],
    ["right", "**"],
    ["right", "!", "~", "typeof", "void", "delete"],
    ["left", ".", "?."],
    ["left", "[", "]"],
    ["left", "(", ")"]
  ],

  // Define the BNF grammar rules
  bnf: {
    // Start symbol
    Root: [
      ["Body", "$$ = $1;"],
      ["", "$$ = new yy.Block();"]
    ],

    Body: [
      ["Line", "$$ = yy.Block.wrap([$1]);"],
      ["Body TERMINATOR Line", "$$ = $1.push($3);"],
      ["Body TERMINATOR", "$$ = $1;"]
    ],

    Line: [
      ["Expression", "$$ = $1;"],
      ["Statement", "$$ = $1;"],
      ["Comment", "$$ = $1;"]
    ],

    Statement: [
      ["Return", "$$ = $1;"],
      ["Throw", "$$ = $1;"],
      ["Break", "$$ = $1;"],
      ["Continue", "$$ = $1;"],
      ["Import", "$$ = $1;"],
      ["Export", "$$ = $1;"]
    ],

    Expression: [
      ["Value", "$$ = $1;"],
      ["Invocation", "$$ = $1;"],
      ["Code", "$$ = $1;"],
      ["Operation", "$$ = $1;"],
      ["Assign", "$$ = $1;"],
      ["If", "$$ = $1;"],
      ["Switch", "$$ = $1;"],
      ["While", "$$ = $1;"],
      ["For", "$$ = $1;"],
      ["Try", "$$ = $1;"],
      ["Class", "$$ = $1;"]
    ],

    // Simple values
    Value: [
      ["Literal", "$$ = $1;"],
      ["Parenthetical", "$$ = $1;"],
      ["Array", "$$ = $1;"],
      ["Object", "$$ = $1;"],
      ["Identifier", "$$ = $1;"],
      ["This", "$$ = $1;"],
      ["Super", "$$ = $1;"],
      ["Access", "$$ = $1;"],
      ["Index", "$$ = $1;"]
    ],

    // Identifiers and keywords
    Identifier: [
      ["IDENTIFIER", "$$ = new yy.Identifier($1);"]
    ],

    This: [
      ["THIS", "$$ = new yy.This();"],
      ["@", "$$ = new yy.This();"]
    ],

    Super: [
      ["SUPER", "$$ = new yy.Super();"]
    ],

    // Literals
    Literal: [
      ["NUMBER", "$$ = new yy.Literal($1);"],
      ["STRING", "$$ = new yy.Literal($1);"],
      ["REGEX", "$$ = new yy.Literal($1);"],
      ["BOOL", "$$ = new yy.Literal($1);"],
      ["NULL", "$$ = new yy.Literal($1);"],
      ["UNDEFINED", "$$ = new yy.Literal($1);"]
    ],

    // Arrays
    Array: [
      ["[ ]", "$$ = new yy.Arr([]);"],
      ["[ ArgList ]", "$$ = new yy.Arr($2.args);"],
      ["[ ArgList , ]", "$$ = new yy.Arr($2.args);"]
    ],

    // Objects
    Object: [
      ["{ }", "$$ = new yy.Obj([]);"],
      ["{ PropertyList }", "$$ = new yy.Obj($2);"],
      ["{ PropertyList , }", "$$ = new yy.Obj($2);"],
      ["{ INDENT PropertyList OUTDENT }", "$$ = new yy.Obj($3);"],
      ["{ INDENT PropertyList , OUTDENT }", "$$ = new yy.Obj($3);"]
    ],

    PropertyList: [
      ["Property", "$$ = [$1];"],
      ["PropertyList , Property", "$$ = $1.concat($3);"],
      ["PropertyList TERMINATOR Property", "$$ = $1.concat($3);"]
    ],

    Property: [
      ["Identifier : Expression", "$$ = new yy.Prop($1, $3);"],
      ["STRING : Expression", "$$ = new yy.Prop(new yy.Literal($1), $3);"],
      ["NUMBER : Expression", "$$ = new yy.Prop(new yy.Literal($1), $3);"],
      ["Identifier", "$$ = new yy.Prop($1, $1);"]  // Shorthand
    ],

    // Parenthetical expressions
    Parenthetical: [
      ["( Expression )", "$$ = new yy.Parens($2);"],
      ["( INDENT Expression OUTDENT )", "$$ = new yy.Parens($3);"]
    ],

    // Comments
    Comment: [
      ["COMMENT", "$$ = new yy.Comment($1);"]
    ],

    // Function calls
    Invocation: [
      ["Value ( )", "$$ = new yy.Call($1, []);"],
      ["Value ( ArgList )", "$$ = new yy.Call($1, $3.args);"],
      ["Value ( ArgList , )", "$$ = new yy.Call($1, $3.args);"],
      ["Super ( )", "$$ = new yy.Call($1, []);"],
      ["Super ( ArgList )", "$$ = new yy.Call($1, $3.args);"]
    ],

    ArgList: [
      ["Arg", "$$ = {args: [$1]};"],
      ["ArgList , Arg", "$$ = {args: $1.args.concat($3)};"],
      ["ArgList TERMINATOR Arg", "$$ = {args: $1.args.concat($3)};"]
    ],

    Arg: [
      ["Expression", "$$ = $1;"],
      ["... Expression", "$$ = new yy.Splat($2);"]
    ],

    // Property access
    Access: [
      ["Value . Identifier", "$$ = new yy.Access($1, $3);"],
      ["Value ?. Identifier", "$$ = new yy.Access($1, $3, 'soak');"]
    ],

    // Array/object indexing
    Index: [
      ["Value [ Expression ]", "$$ = new yy.Index($1, $3);"],
      ["Value ?[ Expression ]", "$$ = new yy.Index($1, $3, 'soak');"]
    ],

    // Assignment
    Assign: [
      ["Assignable = Expression", "$$ = new yy.Assign($1, $3);"],
      ["Assignable = INDENT Expression OUTDENT", "$$ = new yy.Assign($1, $4);"]
    ],

    Assignable: [
      ["Identifier", "$$ = $1;"],
      ["Access", "$$ = $1;"],
      ["Index", "$$ = $1;"],
      ["This", "$$ = $1;"]
    ],

    // Control flow
    Return: [
      ["RETURN Expression", "$$ = new yy.Return($2);"],
      ["RETURN", "$$ = new yy.Return();"]
    ],

    Throw: [
      ["THROW Expression", "$$ = new yy.Throw($2);"]
    ],

    Break: [
      ["BREAK", "$$ = new yy.Break();"]
    ],

    Continue: [
      ["CONTINUE", "$$ = new yy.Continue();"]
    ],

    // Import/Export
    Import: [
      ["IMPORT STRING", "$$ = new yy.Import(new yy.Literal($2));"],
      ["IMPORT { } FROM STRING", "$$ = new yy.Import(new yy.Literal($5), []);"],
      ["IMPORT { ImportList } FROM STRING", "$$ = new yy.Import(new yy.Literal($6), $3);"],
      ["IMPORT Identifier FROM STRING", "$$ = new yy.Import(new yy.Literal($4), null, $2);"],
      ["IMPORT * AS Identifier FROM STRING", "$$ = new yy.Import(new yy.Literal($6), null, $4, true);"]
    ],

    ImportList: [
      ["Identifier", "$$ = [$1];"],
      ["ImportList , Identifier", "$$ = $1.concat($3);"]
    ],

    Export: [
      ["EXPORT Expression", "$$ = new yy.Export($2);"],
      ["EXPORT DEFAULT Expression", "$$ = new yy.Export($3, true);"],
      ["EXPORT { }", "$$ = new yy.Export(new yy.Obj([]));"],
      ["EXPORT { ExportList }", "$$ = new yy.Export(new yy.Obj($3));"]
    ],

    ExportList: [
      ["Identifier", "$$ = [new yy.Prop($1, $1)];"],
      ["ExportList , Identifier", "$$ = $1.concat(new yy.Prop($3, $3));"]
    ],

    // Functions
    Code: [
      ["-> Block", "$$ = new yy.Code([], $2);"],
      ["=> Block", "$$ = new yy.Code([], $2, true);"],
      ["ParamList -> Block", "$$ = new yy.Code($1.params, $3);"],
      ["ParamList => Block", "$$ = new yy.Code($1.params, $3, true);"]
    ],

    ParamList: [
      ["( )", "$$ = {params: []};"],
      ["( ParamListItems )", "$$ = {params: $2};"],
      ["( ParamListItems , )", "$$ = {params: $2};"]
    ],

    ParamListItems: [
      ["Param", "$$ = [$1];"],
      ["ParamListItems , Param", "$$ = $1.concat($3);"]
    ],

    Param: [
      ["Identifier", "$$ = new yy.Param($1);"],
      ["Identifier = Expression", "$$ = new yy.Param($1, $3);"],
      ["... Identifier", "$$ = new yy.Param($2, null, true);"]
    ],

    Block: [
      ["INDENT Body OUTDENT", "$$ = $2;"],
      ["Expression", "$$ = yy.Block.wrap([$1]);"]
    ],

    // Classes (simplified)
    Class: [
      ["CLASS Identifier", "$$ = new yy.Class($2);"],
      ["CLASS Identifier EXTENDS Value", "$$ = new yy.Class($2, $4);"],
      ["CLASS Identifier Block", "$$ = new yy.Class($2, null, $3);"],
      ["CLASS Identifier EXTENDS Value Block", "$$ = new yy.Class($2, $4, $5);"]
    ]
  }
};

export default grammar;