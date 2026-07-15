import { describe, expect, test } from 'bun:test';
import { RsxError, parse, stringify } from '@rip-lang/rsx';

describe('parse: tree shape', () => {
  test('text-only element collapses to a scalar string', () => {
    expect(parse('<a>x</a>')).toEqual({ a: 'x' });
  });

  test('nested elements become nested objects', () => {
    expect(parse('<a><b>1</b><c>2</c></a>')).toEqual({ a: { b: '1', c: '2' } });
    expect(parse('<a><b><c>deep</c></b></a>')).toEqual({ a: { b: { c: 'deep' } } });
  });

  test('repeated sibling tags collapse into arrays', () => {
    expect(parse('<l><i>a</i><i>b</i></l>')).toEqual({ l: { i: ['a', 'b'] } });
    expect(parse('<l><i>a</i><i>b</i><i>c</i></l>')).toEqual({ l: { i: ['a', 'b', 'c'] } });
  });

  test('attributes group under @attrs; text joins as #text', () => {
    expect(parse('<a id="1" name="n">x</a>')).toEqual({
      a: { '@attrs': { id: '1', name: 'n' }, '#text': 'x' },
    });
  });

  test('attribute-bearing element with no text keeps object form without #text', () => {
    expect(parse('<a id="1"></a>')).toEqual({ a: { '@attrs': { id: '1' } } });
  });

  test('self-closing elements: bare becomes empty string, with attrs keeps object form', () => {
    expect(parse('<a/>')).toEqual({ a: '' });
    expect(parse('<a />')).toEqual({ a: '' });
    expect(parse('<a id="1"/>')).toEqual({ a: { '@attrs': { id: '1' } } });
  });

  test('empty element collapses to empty string', () => {
    expect(parse('<a></a>')).toEqual({ a: '' });
    expect(parse('<a>   </a>')).toEqual({ a: '' });
  });

  test('multiple root elements all land on the result object', () => {
    expect(parse('<a>1</a><b>2</b>')).toEqual({ a: '1', b: '2' });
    expect(parse('<a>1</a><a>2</a>')).toEqual({ a: ['1', '2'] });
  });

  test('empty input yields an empty object', () => {
    expect(parse('')).toEqual({});
  });

  test('mixed content: text around child elements is dropped by default', () => {
    // Documented: mixed content does not round-trip unless preserveChildren.
    expect(parse('<a>hi<b>x</b>bye</a>')).toEqual({ a: { b: 'x' } });
  });

  test('text outside the root element is ignored', () => {
    expect(parse('junk<a>x</a>')).toEqual({ a: 'x' });
    expect(parse('<a>x</a>trailing')).toEqual({ a: 'x' });
  });
});

describe('parse: text and whitespace', () => {
  test('trimText collapses interior whitespace by default', () => {
    expect(parse('<a>  hello   world \n</a>')).toEqual({ a: 'hello world' });
  });

  test('trimText: false preserves text verbatim', () => {
    expect(parse('<a>  hello   world \n</a>', { trimText: false })).toEqual({
      a: '  hello   world \n',
    });
  });

  test('coerceNumbers / coerceBooleans never coerce — text stays text', () => {
    expect(parse('<a>42</a>', { coerceNumbers: true, coerceBooleans: true })).toEqual({ a: '42' });
    expect(parse('<a>true</a>')).toEqual({ a: 'true' });
  });
});

describe('parse: entities', () => {
  test('the five built-in entities decode in text', () => {
    expect(parse('<a>&amp;&lt;&gt;&quot;&apos;</a>')).toEqual({ a: '&<>"\'' });
  });

  test('numeric character references decode, decimal and hex, up to astral planes', () => {
    expect(parse('<a>&#65;&#x41;&#x1F600;</a>')).toEqual({ a: 'AA\u{1F600}' });
  });

  test('unknown named entities pass through untouched', () => {
    expect(parse('<a>&foo; &copy;</a>')).toEqual({ a: '&foo; &copy;' });
  });

  test('out-of-range numeric references pass through untouched', () => {
    expect(parse('<a>&#x110000;</a>')).toEqual({ a: '&#x110000;' });
  });

  test('bare ampersands survive', () => {
    expect(parse('<a>a & b</a>')).toEqual({ a: 'a & b' });
  });

  test('entities decode inside attribute values', () => {
    expect(parse('<a t="&lt;&amp;&#65;">x</a>')).toEqual({
      a: { '@attrs': { t: '<&A' }, '#text': 'x' },
    });
  });
});

describe('parse: CDATA', () => {
  test('CDATA content is verbatim — no trim, no entity decode', () => {
    expect(parse('<a><![CDATA[  <raw> & stuff  ]]></a>')).toEqual({ a: '  <raw> & stuff  ' });
    expect(parse('<a><![CDATA[&amp;]]></a>')).toEqual({ a: '&amp;' });
  });

  test('CDATA concatenates with surrounding (trimmed) text', () => {
    expect(parse('<a> hi <![CDATA[ raw ]]> bye </a>')).toEqual({ a: 'hi raw bye' });
  });

  test('empty CDATA collapses to empty string', () => {
    expect(parse('<a><![CDATA[]]></a>')).toEqual({ a: '' });
  });

  test('unterminated CDATA throws', () => {
    expect(() => parse('<a><![CDATA[oops</a>')).toThrow('unterminated CDATA');
  });
});

describe('parse: comments, processing instructions, DOCTYPE', () => {
  test('comments are skipped', () => {
    expect(parse('<a><!-- hi -->x</a>')).toEqual({ a: 'x' });
  });

  test('unterminated comment throws', () => {
    expect(() => parse('<a><!-- oops</a>')).toThrow('unterminated comment');
  });

  test('processing instructions are skipped by default', () => {
    expect(parse('<?xml version="1.0"?><a>x</a>')).toEqual({ a: 'x' });
  });

  test('allowProcessingInstructions: false rejects PIs', () => {
    expect(() => parse('<?xml?><a>x</a>', { allowProcessingInstructions: false })).toThrow(
      'processing instructions are not allowed',
    );
  });

  test('unterminated processing instruction throws', () => {
    expect(() => parse('<?xml <a>x</a>')).toThrow('unterminated processing instruction');
  });

  test('DOCTYPE is rejected by default (no XXE)', () => {
    expect(() => parse('<!DOCTYPE html><a>x</a>')).toThrow('DOCTYPE declarations are not allowed');
  });

  test('allowDoctype: true skips the declaration, upper- or lowercase', () => {
    expect(parse('<!DOCTYPE html><a>x</a>', { allowDoctype: true })).toEqual({ a: 'x' });
    expect(parse('<!doctype html><a>x</a>', { allowDoctype: true })).toEqual({ a: 'x' });
  });

  test('custom entity declarations are never honored', () => {
    const xml = '<!DOCTYPE a [<!ENTITY xxe "boom">]><a>&xxe;</a>';
    expect(() => parse(xml)).toThrow(RsxError);
  });

  test("unknown '<!' constructs throw", () => {
    expect(() => parse('<!ELEMENT foo><a>x</a>')).toThrow("unexpected '<!' construct");
  });
});

describe('parse: namespaces', () => {
  test('namespace prefixes strip from tags and attributes by default', () => {
    expect(parse('<ns:a x:id="1"><ns2:b>x</ns2:b></ns:a>')).toEqual({
      a: { '@attrs': { id: '1' }, b: 'x' },
    });
  });

  test('stripNamespaces: false preserves prefixes verbatim', () => {
    expect(parse('<ns:a x:id="1"><ns2:b>x</ns2:b></ns:a>', { stripNamespaces: false })).toEqual({
      'ns:a': { '@attrs': { 'x:id': '1' }, 'ns2:b': 'x' },
    });
  });

  test('close tags match on the stripped name — prefixes are opaque labels', () => {
    expect(parse('<ns:a>x</other:a>')).toEqual({ a: 'x' });
  });
});

describe('parse: attribute forms', () => {
  test('double-quoted, single-quoted, unquoted, and valueless attributes', () => {
    expect(parse("<a t='v'>x</a>").a['@attrs']).toEqual({ t: 'v' });
    expect(parse('<a t=v>x</a>').a['@attrs']).toEqual({ t: 'v' });
    expect(parse('<a checked>x</a>').a['@attrs']).toEqual({ checked: '' });
  });

  test("a quoted '>' inside an attribute value does not end the tag", () => {
    expect(parse('<a t="a>b">x</a>').a['@attrs']).toEqual({ t: 'a>b' });
  });

  test('whitespace around = and newlines inside tags are tolerated', () => {
    expect(parse('<a  t = "v"  u="w" >x</a>').a['@attrs']).toEqual({ t: 'v', u: 'w' });
    expect(parse('<a\n  t="v"\n>x</a>').a['@attrs']).toEqual({ t: 'v' });
  });

  test('duplicate attributes: last one wins', () => {
    expect(parse('<a t="1" t="2">x</a>').a['@attrs']).toEqual({ t: '2' });
  });
});

describe('parse: forceArray', () => {
  test('accepts an array, a Set, or a predicate function', () => {
    expect(parse('<l><i>a</i></l>', { forceArray: ['i'] })).toEqual({ l: { i: ['a'] } });
    expect(parse('<l><i>a</i></l>', { forceArray: new Set(['i']) })).toEqual({ l: { i: ['a'] } });
    expect(parse('<l><i>a</i></l>', { forceArray: (n) => n === 'i' })).toEqual({ l: { i: ['a'] } });
  });

  test('applies to self-closing elements too', () => {
    expect(parse('<l><i/></l>', { forceArray: ['i'] })).toEqual({ l: { i: [''] } });
  });

  test('non-listed tags still collapse to scalars', () => {
    expect(parse('<l><j>a</j></l>', { forceArray: ['i'] })).toEqual({ l: { j: 'a' } });
  });
});

describe('parse: preserveChildren', () => {
  test('@children records text and self-closed children in document order', () => {
    expect(parse('<a>hi<b>x</b>bye<c/></a>', { preserveChildren: true })).toEqual({
      a: { b: 'x', c: '', '@children': ['hi', 'bye', { name: 'c', value: '' }] },
    });
  });

  test('text-only elements still collapse to scalars', () => {
    expect(parse('<a>hi</a>', { preserveChildren: true })).toEqual({ a: 'hi' });
  });
});

describe('parse: custom keys', () => {
  test('attrsKey and textKey rename the grouped keys', () => {
    expect(parse('<a id="1">x</a>', { attrsKey: '$a', textKey: '$t' })).toEqual({
      a: { $a: { id: '1' }, $t: 'x' },
    });
  });
});

describe('parse: errors and limits', () => {
  test('non-string input throws RsxError', () => {
    expect(() => parse(42)).toThrow('XML source must be a string');
    expect(() => parse(null)).toThrow(RsxError);
  });

  test('maxBytes caps input length', () => {
    const err = (() => {
      try {
        parse('<a>xxxxx</a>', { maxBytes: 4 });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(RsxError);
    expect(err.message).toBe('input exceeds maxBytes (4)');
    expect(err.offset).toBe(0);
  });

  test('default maxBytes admits ordinary documents', () => {
    const big = `<l>${'<i>x</i>'.repeat(10000)}</l>`;
    expect(parse(big).l.i.length).toBe(10000);
  });

  test('mismatched close tags throw with both names in the message', () => {
    expect(() => parse('<a><b>x</c></a>')).toThrow(
      'mismatched close tag: expected </b>, got </c>',
    );
    expect(() => parse('<a>x</a></b>')).toThrow('mismatched close tag: expected </>, got </b>');
  });

  test('unclosed elements at EOF do not throw; buffered text is dropped', () => {
    expect(parse('<a><b>x')).toEqual({ a: { b: {} } });
  });

  test('unterminated markup throws with a scan offset', () => {
    for (const [xml, msg, offset] of [
      ['<a', 'unterminated start tag', 0],
      ['<a>x</a', 'unterminated end tag', 4],
      ['< >x</ >', 'missing tag name', 3],
    ]) {
      const err = (() => {
        try {
          parse(xml);
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(RsxError);
      expect(err.message).toBe(msg);
      expect(err.offset).toBe(offset);
    }
  });

  test('RsxError is a proper Error subclass', () => {
    const err = new RsxError('boom', 7);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('RsxError');
    expect(err.message).toBe('boom');
    expect(err.offset).toBe(7);
  });

  test('caller option objects are never mutated', () => {
    const opts = { forceArray: ['i'] };
    parse('<l><i>a</i></l>', opts);
    expect(opts).toEqual({ forceArray: ['i'] });
  });
});

describe('stringify: scalars and structure', () => {
  test('scalars emit as escaped text', () => {
    expect(stringify('a', 'x')).toBe('<a>x</a>');
    expect(stringify('a', 42)).toBe('<a>42</a>');
    expect(stringify('a', true)).toBe('<a>true</a>');
    expect(stringify('a', '')).toBe('<a></a>');
  });

  test('null, undefined, and empty objects emit self-closing tags', () => {
    expect(stringify('a', null)).toBe('<a/>');
    expect(stringify('a', undefined)).toBe('<a/>');
    expect(stringify('a', {})).toBe('<a/>');
    expect(stringify('a', { '#text': '' })).toBe('<a/>');
    expect(stringify('a', { b: null })).toBe('<a><b/></a>');
  });

  test('nested objects and arrays', () => {
    expect(stringify('a', { b: '1', c: '2' })).toBe('<a><b>1</b><c>2</c></a>');
    expect(stringify('l', { i: ['a', 'b'] })).toBe('<l><i>a</i><i>b</i></l>');
    expect(stringify('l', { i: [] })).toBe('<l></l>');
  });

  test('@attrs and #text render as attributes and text', () => {
    expect(stringify('a', { '@attrs': { id: '1' }, '#text': 'x' })).toBe('<a id="1">x</a>');
    expect(stringify('a', { '@attrs': { id: '1' } })).toBe('<a id="1"/>');
    expect(stringify('a', { '@attrs': { id: '1' }, b: 'x' })).toBe('<a id="1"><b>x</b></a>');
  });

  test('#text is dropped when child elements are present', () => {
    expect(stringify('a', { '@attrs': { id: '1' }, '#text': 'T', b: 'x' })).toBe(
      '<a id="1"><b>x</b></a>',
    );
  });

  test('@children is never serialized', () => {
    expect(stringify('a', { '@children': ['hi'], b: 'x' })).toBe('<a><b>x</b></a>');
  });

  test('custom attrsKey / textKey', () => {
    expect(
      stringify('a', { $a: { id: '1' }, $t: 'x' }, { attrsKey: '$a', textKey: '$t' }),
    ).toBe('<a id="1">x</a>');
  });
});

describe('stringify: escaping', () => {
  test('text escapes & < > but not quotes', () => {
    expect(stringify('a', 'a & <b> "q" \'s\'')).toBe('<a>a &amp; &lt;b&gt; "q" \'s\'</a>');
  });

  test('attribute values escape & < " but not > or single quotes', () => {
    expect(stringify('a', { '@attrs': { t: 'a & <b> "q" \'s\'' } })).toBe(
      '<a t="a &amp; &lt;b> &quot;q&quot; \'s\'"/>',
    );
  });
});

describe('stringify: indentation', () => {
  test('numeric indent expands to spaces with newlines', () => {
    expect(stringify('a', { b: { c: 'x' } }, { indent: 2 })).toBe(
      '<a>\n  <b>\n    <c>x</c>\n  </b>\n</a>',
    );
  });

  test('string indent is used verbatim', () => {
    expect(stringify('a', { b: 'x' }, { indent: '\t' })).toBe('<a>\n\t<b>x</b>\n</a>');
  });

  test('custom newline overrides the indent-implied one', () => {
    expect(stringify('a', { b: 'x' }, { indent: 2, newline: '|' })).toBe('<a>|  <b>x</b>|</a>');
  });

  test('indented arrays of attribute nodes', () => {
    expect(stringify('l', { i: [{ '@attrs': { n: '1' } }, 'b'] }, { indent: 2 })).toBe(
      '<l>\n  <i n="1"/>\n  <i>b</i>\n</l>',
    );
  });
});

describe('stringify: CDATA', () => {
  test('cdata option wraps listed tag content, array or Set', () => {
    expect(stringify('a', { p: 'raw <x> & y' }, { cdata: ['p'] })).toBe(
      '<a><p><![CDATA[raw <x> & y]]></p></a>',
    );
    expect(stringify('a', { p: 'z' }, { cdata: new Set(['p']) })).toBe(
      '<a><p><![CDATA[z]]></p></a>',
    );
    expect(stringify('p', 7, { cdata: ['p'] })).toBe('<p><![CDATA[7]]></p>');
  });

  test("']]>' inside CDATA content splits into two sections", () => {
    expect(stringify('a', { p: 'x]]>y' }, { cdata: ['p'] })).toBe(
      '<a><p><![CDATA[x]]]]><![CDATA[>y]]></p></a>',
    );
  });
});

describe('round trips', () => {
  test('attribute/array documents survive parse → stringify', () => {
    const xml =
      '<order id="7"><item sku="a">1</item><item sku="b">2</item><note>hi</note></order>';
    expect(stringify('order', parse(xml).order)).toBe(xml);
  });

  test('SOAP-shaped envelope: parse, address payload, re-serialize with CDATA', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<soapenv:Envelope soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
      '<soapenv:Body>',
      '<ns1:COREEnvelopeRealTimeRequest>',
      '<PayloadType>X12_270_Request_005010X279A1</PayloadType>',
      '<Payload><![CDATA[ISA*00*  &raw& *]]></Payload>',
      '</ns1:COREEnvelopeRealTimeRequest>',
      '</soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('');
    const doc = parse(xml);
    const req = doc.Envelope.Body.COREEnvelopeRealTimeRequest;
    expect(req.PayloadType).toBe('X12_270_Request_005010X279A1');
    expect(req.Payload).toBe('ISA*00*  &raw& *');
    expect(stringify('Payload', req.Payload, { cdata: ['Payload'] })).toBe(
      '<Payload><![CDATA[ISA*00*  &raw& *]]></Payload>',
    );
  });

  test('CDATA split round trips through parse', () => {
    const emitted = stringify('p', 'x]]>y', { cdata: ['p'] });
    expect(parse(emitted, { trimText: false })).toEqual({ p: 'x]]>y' });
  });
});
