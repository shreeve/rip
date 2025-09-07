// Generated via Rip bootstrap (CoffeeScript → ES6/ESM)

const o = (...args) => args;

const grammar = {
  Program: [
    o(''), o('Body', {
      body: '$1'
    })
  ],
  Body: [
    o('Line', {
      wrap: '$1'
    }), o('Body TERMINATOR Line', {
      push: '$3'
    }), o('Body TERMINATOR')
  ],
  Line: [o('Expression')],
  Expression: [o('Value')],
  Value: [o('Assignable'), o('Literal'), o('Invocation')],
  Assignable: [o('SimpleAssignable')],
  SimpleAssignable: [
    o('Identifier'), o('Value Accessor', {
      type: 'MemberExpression',
      object: '$1',
      property: '$2'
    })
  ],
  Identifier: [
    o('IDENTIFIER', {
      type: 'Identifier',
      name: '$1'
    })
  ],
  Accessor: [
    o('.  Property', {
      type: 'MemberExpression',
      computed: false,
      property: '$2'
    }), o('?. Property', {
      type: 'OptionalMemberExpression',
      property: '$2'
    }), o(':: Property', {
      type: 'PrototypeAccess',
      property: '$2'
    }), o('?:: Property', {
      type: 'OptionalPrototypeAccess',
      property: '$2'
    }), o('::', {
      type: 'PrototypeAccess'
    }), o('?::', {
      type: 'OptionalPrototypeAccess'
    })
  ],
  Property: [
    o('PROPERTY', {
      type: 'Property',
      name: '$1'
    })
  ],
  Invocation: [
    o('Value OptFuncExist String', {
      type: 'TaggedTemplateExpression',
      tag: '$1',
      quasi: '$3',
      optional: '$2'
    }), o('Value OptFuncExist Arguments', {
      type: 'CallExpression',
      callee: '$1',
      args: '$3',
      optional: '$2'
    }), o('SUPER OptFuncExist Arguments', {
      type: 'SuperCall',
      args: '$3',
      optional: '$2'
    }), o('DYNAMIC_IMPORT Arguments', {
      type: 'Import',
      args: '$2',
      dynamic: true
    })
  ],
  OptFuncExist: [o('', false), o('FUNC_EXIST', true)],
  Arguments: [
    o('CALL_START CALL_END', []), o('CALL_START ArgList OptComma CALL_END', {
      code: ($1, $2) => {
        $2.implicit = $1.generated;
        return $2;
      }
    })
  ],
  ArgList: [
    o('Arg', ['$1']), o('ArgList , Arg', {
      code: ($1, $2, $3) => $1.concat($3)
    }), o('ArgList OptComma TERMINATOR Arg', {
      code: ($1, $2, $3, $4) => $1.concat($4)
    })
  ],
  OptComma: [o('', null), o(',', null)],
  Arg: [o('Expression')],
  Literal: [
    o('AlphaNumeric'), o('JS', {
      type: 'JSLiteral',
      code: '$1'
    }), o('UNDEFINED', {
      type: 'Undefined'
    }), o('NULL', {
      type: 'NullLiteral'
    }), o('BOOL', {
      type: 'BooleanLiteral',
      value: '$1'
    }), o('INFINITY', {
      type: 'Infinity',
      value: '$1'
    }), o('NAN', {
      type: 'NaN'
    })
  ],
  AlphaNumeric: [
    o('NUMBER', {
      type: 'NumericLiteral',
      value: '$1'
    }), o('String')
  ],
  String: [
    o('STRING', {
      code: ($1) => ({
        type: 'StringLiteral',
        value: $1.slice(1, -1),
        raw: $1
      })
    })
  ]
};

const operators = [];

// Process grammar rules - add return statement to Program rules
for (const [name, alternatives] of Object.entries(grammar)) {
  grammar[name] = alternatives.map(alt => {
    if (name === 'Program') {
      // For Program rules, add return statement
      alt[1] = `return ${alt[1]}`;
    }
    return alt;
  });
}

export default {
  bnf: grammar,
  operators: operators.reverse()
};
