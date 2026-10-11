<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Vista

> **Call VistA's RPCs over HTTPS, the RPC Broker's messages byte for byte — zero runtime dependencies.**

Each call is one `POST /rpc` to Janus. The body is a broker message, the
same bytes CPRS writes. Janus hands it to the session's em process, where
VistA's own broker runs it. The reply comes back unchanged and is decoded
here. Each session sends one request at a time, in order. The contract is
OpenVista's `docs/RPC-HTTPS.md`: §3 covers the messages and §4 the sign-on.

**Runtime:** browser-safe (`rip.browser: true`). One `.rip` file. Under Bun
it works the same: pass `url:` and it carries the session token itself.

## Quick Start

```coffee
import vista from 'rip/vista'

intro = vista.connect!                    # TCPConnect + XUS SIGNON SETUP → intro text
me = vista.signOn! access, verify         # XUS AV CODE → { duz, mustChangeVerify, … }
vista.changeVerify! verify, fresh, fresh if me.mustChangeVerify
vista.context! 'OR CPRS GUI CHART'        # XWB CREATE CONTEXT
vista.keepalive!                          # XWB IM HERE at half the idle timeout

pt = vista.rpc! 'ORWPT SELECT', dfn       # the data, as VistA returns it
rows = vista.lines! 'ORQQAL LIST', dfn    # the data split on \r\n

vista.bye!                                # #BYE#: VistA logs the user out
```

`vista` is the page's own session (same origin, the browser's cookie). For a
script or a test, make one with the site's address:

```coffee
s = vista.session url: 'https://vista.example.org'
```

## Parameters

| Value | Sent as |
|---|---|
| a string, or a finite number in plain decimal form | a literal |
| `null` / `undefined` / `''` | an empty literal (later parameters keep their places) |
| `{1: 'a', TEXT: 'b'}` | a list: numeric subscripts bare, text quoted (`"TEXT"`) |
| `[[['TEXT', 1, 0], 'line']]` | a list with multi-level subscripts (`"TEXT",1,0`) |
| `{}` or `[]` | an empty list |

Anything else rejects before a byte is sent: a boolean, a nested object, or
a number with no plain form (`1e21`). Reference and global-array parameters
are not offered.

Text travels as **Windows-1252**, as CPRS writes VistA's text, and every
length counts those bytes. A character the code page cannot hold (`漢`,
`🙂`) is an error, never a `?`.

Codes, a context option and an electronic signature reach Kernel's DECRYP
wrapped in one space. Equal first and last characters translate nothing,
so the value arrives as sent. `wrap` does this for RPCs such as
`TIU SIGN RECORD`:

```coffee
vista.rpc! 'TIU SIGN RECORD', ien, vista.wrap(code)
```

## Errors

Every failure is a `VistaError` with a `kind`:

| kind | When |
|---|---|
| `request` | a message this package will not build (a bad parameter, an unencodable character, over 1 MiB) |
| `security` | the broker refused to run the RPC (not signed on, no context, OpenVista's guards) |
| `error` | the RPC's error message |
| `m` | an M error; `detail` holds its full text |
| `signon` | `TCPConnect` rejected, codes or a new verify code not accepted, or a context not created |
| `ended` | Janus's 401: the session is over; `sessionEnded` says why |
| `transport` | any other status from Janus (`status`, `retryAfter`), or a reply that is not `application/x-xwb` |
| `reply` | bytes that are not one broker reply |

## Messages

`encode`, `encodeCommand` and `decode` are the wire format by themselves,
for a relay or a test:

```coffee
import { encode, decode, wrap } from 'rip/vista'

encode 'XUS AV CODE', [wrap('ACCESS;VERIFY')]   # [XWB]11302 \x010 \x0BXUS AV CODE 5 0015 " ACCESS;VERIFY " f \x04
decode bytes                                    # { security, error, data, mError }
```

## Test

```bash
bun run test
```

The suite checks requests and replies against the contract's bytes, which
were measured on em. It drives sessions through a recording fetch: sign-on,
errors, the 401 end, in-order requests, keepalive and `#BYE#`.
