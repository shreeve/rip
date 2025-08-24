// mumps_lex.zig
// Minimal, fast lexer for M (MUMPS) with a stable C ABI.
// Produces flat tokens for top-level scanning; expressions remain parsed in JS.
//
// Build (macOS):
//   zig build-lib -OReleaseFast -dynamic mumps_lex.zig -femit-bin=libmumps_lex.dylib
// Build (Linux):
//   zig build-lib -OReleaseFast -dynamic mumps_lex.zig -femit-bin=libmumps_lex.so
//
// Exports:
//   pub export fn lex_count(ptr: [*]const u8, len: u32) callconv(.C) u32
//   pub export fn lex_fill(ptr: [*]const u8, len: u32, out_ptr: [*]Token, out_len: u32) callconv(.C) u32
//
// Token layout matches JS:
//   Uint32Array triples: [kind, start, end] * N
// where `kind` matches TokenKind in zig-lex.js and mumps-parser-pro.js.

const std = @import("std");

pub const Token = extern struct {
    kind: u16, // see TokenKind
    start: u32,
    end: u32,
};

pub const TokenKind = enum(u16) {
    Ident = 1, Number, String, Space, Newline, Semi, LParen, RParen, Comma,
    Caret, Dollar, At, Colon, Plus, Minus, Star, Slash, BSlash, Hash, Und,
    Amp, Bang, Tick, Lt, Gt, Eq, QMark, LBr, RBr, Dot, Other,
};

fn classify(b: u8) TokenKind {
    return switch (b) {
        'a'...'z', 'A'...'Z', '%' => .Ident,
        '0'...'9' => .Number,
        '"' => .String,
        ' ', '\t' => .Space,
        '\n' => .Newline,
        ';' => .Semi, '(' => .LParen, ')' => .RParen, ',' => .Comma,
        '^' => .Caret, '$' => .Dollar, '@' => .At, ':' => .Colon,
        '+' => .Plus, '-' => .Minus, '*' => .Star, '/' => .Slash,
        '\\' => .BSlash, '#' => .Hash, '_' => .Und, '&' => .Amp,
        '!' => .Bang, '\'' => .Tick, '<' => .Lt, '>' => .Gt, '=' => .Eq,
        '?' => .QMark, '[' => .LBr, ']' => .RBr, '.' => .Dot,
        else => .Other,
    };
}

fn read_ident(src: []const u8, idx0: usize) usize {
    var i = idx0 + 1;
    while (i < src.len) {
        const k = classify(src[i]);
        if (k == .Ident or k == .Number) i += 1 else break;
    }
    return i;
}

fn read_number(src: []const u8, idx0: usize) usize {
    var i = idx0;
    if (src[i] == '.') i += 1;
    while (i < src.len and src[i] >= '0' and src[i] <= '9') : (i += 1) {}
    if (i < src.len and src[i] == '.') {
        i += 1;
        while (i < src.len and src[i] >= '0' and src[i] <= '9') : (i += 1) {}
    }
    return i;
}

fn read_string(src: []const u8, idx0: usize) usize {
    var i = idx0 + 1;
    while (i < src.len) : (i += 1) {
        if (src[i] == '"') {
            if (i + 1 < src.len and src[i + 1] == '"') { // doubled quote
                i += 1;
                continue;
            }
            return i + 1;
        }
    }
    return i;
}

/// Pass 1: count tokens. Returns number of tokens.
pub export fn lex_count(ptr: [*]const u8, len: u32) callconv(.C) u32 {
    const src = ptr[0..len];
    var i: usize = 0;
    var count: u32 = 0;
    while (i < src.len) {
        const k = classify(src[i]);
        switch (k) {
            .Ident => i = read_ident(src, i),
            .Number => i = read_number(src, i),
            .String => i = read_string(src, i),
            else => i += 1,
        }
        count += 1;
    }
    return count;
}

/// Pass 2: fill the provided Token array (out_len must be >= lex_count).
/// Returns tokens written (== out_len on success).
pub export fn lex_fill(ptr: [*]const u8, len: u32, out_ptr: [*]Token, out_len: u32) callconv(.C) u32 {
    const src = ptr[0..len];
    var i: usize = 0;
    var w: u32 = 0;
    while (i < src.len and w < out_len) {
        const k = classify(src[i]);
        var j: usize = i + 1;
        switch (k) {
            .Ident => j = read_ident(src, i),
            .Number => j = read_number(src, i),
            .String => j = read_string(src, i),
            else => j = i + 1,
        }
        out_ptr[w] = Token{
            .kind = @intFromEnum(k),
            .start = @intCast(i),
            .end = @intCast(j),
        };
        w += 1;
        i = j;
    }
    return w;
}
