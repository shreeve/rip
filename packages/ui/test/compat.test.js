import { test, expect } from 'bun:test';
import {
  computeMsoPadding,
  convertToPx,
  parsePadding,
  previewPadding,
  pxToPt,
  styleToString,
} from '../email/compat.rip';

test('email compatibility helpers normalize units and styles', () => {
  expect(pxToPt(16)).toBe(12);
  expect(convertToPx('1.5rem')).toBe(24);
  expect(parsePadding({ padding: '8px 12px', paddingLeft: '4px' })).toEqual({
    paddingTop: 8,
    paddingRight: 12,
    paddingBottom: 8,
    paddingLeft: 4,
  });
  expect(computeMsoPadding(0)).toEqual([0, 0]);
  expect(previewPadding('x').length).toBe(1043);
  expect(styleToString({ fontSize: '14px', msoTextRaise: 12 }))
    .toBe('font-size:14px;mso-text-raise:12');
});
