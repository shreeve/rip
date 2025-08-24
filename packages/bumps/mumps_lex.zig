// mumps_lex.zig
const std = @import("std");

pub const Token = extern struct {
    kind: u16,  // see TokenKind
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
        ' ' , '\t' => .Space,
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

fn read_ident(src: []const u8, i0: usize) usize {
    var i = i0 + 1;
    while (i < src.len) {
        const k = classify(src[i]);
        if (k == .Ident or k == .Number) { i += 1; } else break;
    }
    return i;
}

fn read_number(src: []const u8, i0: usize) usize {
    var i = i0;
    if (src[i] == '.') i += 1;
    while (i < src.len and src[i] >= '0' and src[i] <= '9') : (i += 1) {}
    if (i < src.len and src[i] == '.') {
        i += 1;
        while (i < src.len and src[i] >= '0' and src[i] <= '9') : (i += 1) {}
    }
    return i;
}

fn read_string(src: []const u8, i0: usize) usize {
    var i = i0 + 1;
    while (i < src.len) : (i += 1) {
        if (src[i] == '"') {
            if (i + 1 < src.len and src[i + 1] == '"') { i += 1; continue; }
            return i + 1;
        }
    }
    return i;
}

/// Pass 1: count tokens.
/// C-ABI: returns number of tokens.
export fn lex_count(ptr: [*]const u8, len: u32) callconv(.C) u32 {
    const src = ptr[0..len];
    var i: usize = 0;
    var count: u32 = 0;
    while (i < src.len) {
        const k = classify(src[i]);
        switch (k) {
            .Ident => { i = read_ident(src, i); },
            .Number => { i = read_number(src, i); },
            .String => { i = read_string(src, i); },
            else => { i += 1; },
        }
        count += 1;
    }
    return count;
}

/// Pass 2: fill provided Token array (len == result of lex_count).
/// Returns number of tokens written (== requested len on success).
export fn lex_fill(ptr: [*]const u8, len: u32, out_ptr: [*]Token, out_len: u32) callconv(.C) u32 {
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
        out_ptr[w] = Token{ .kind = @intFromEnum(k), .start = @intCast(i), .end = @intCast(j) };
        w += 1;
        i = j;
    }
    return w;
}
