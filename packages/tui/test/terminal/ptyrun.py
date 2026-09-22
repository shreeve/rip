# A shell with job control, for test/terminal.rip: a pty is opened, the
# command runs in it as a job in a process group of its own, and what the
# shell would do is scripted from outside: keys typed, the job continued
# (%fg), a signal sent to it. Every event goes to stdout as one JSON line
# — started, stopped, continued, exited, killed, and the pty's output as
# it comes — so a test waits on states, never on time. A job that
# outlives the deadline is continued and killed, never left behind.
#
#   python3 ptyrun.py <cwd> <keys.json> -- cmd args...
#
# keys.json is [[delay_ms, step], ...]: a step is text to type, "?text"
# to wait until the pty has shown text, "%fg" to continue a stopped job
# (waiting for the stop first), or "@SIGNAL" to send that signal to the
# job's leader.

import json, os, pty, select, signal, subprocess, sys, time

cwd = sys.argv[1]
steps = json.load(open(sys.argv[2]))
cmd = sys.argv[sys.argv.index('--') + 1:]
DEADLINE = 8.0

def say(**event):
    sys.stdout.write(json.dumps(event) + '\n')
    sys.stdout.flush()

# The shell tells the driver what the job does on one pipe, and the
# driver tells the shell to continue it on the other: neither goes
# through the pty, which is the job's alone.
told_r, told_w = os.pipe()
asked_r, asked_w = os.pipe()

pid, fd = pty.fork()
if pid == 0:
    # The shell: a session leader on the pty, with the job as its
    # foreground process group, told of every stop and continue.
    import fcntl, struct, termios
    os.close(told_r)
    os.close(asked_w)
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 10, 40, 0, 0))
    for s in (signal.SIGTSTP, signal.SIGTTIN, signal.SIGINT, signal.SIGTERM):
        signal.signal(s, signal.SIG_DFL)
    signal.signal(signal.SIGTTOU, signal.SIG_IGN)
    env = dict(os.environ)
    env.pop('CI', None)
    env.pop('NO_COLOR', None)
    env['TERM'] = 'xterm-256color'
    job = subprocess.Popen(cmd, cwd=cwd, env=env, preexec_fn=lambda: os.setpgid(0, 0))
    try:
        os.tcsetpgrp(0, job.pid)
    except OSError:
        pass
    def tell(text):
        os.write(told_w, (text + '\n').encode())
    tell('started %d' % job.pid)
    asked = os.fdopen(asked_r)
    while True:
        try:
            _, status = os.waitpid(job.pid, os.WUNTRACED | os.WCONTINUED)
        except ChildProcessError:
            os._exit(0)
        if os.WIFSTOPPED(status):
            tell('stopped %d' % os.WSTOPSIG(status))
            if asked.readline().strip() == 'fg':
                try:
                    os.tcsetpgrp(0, job.pid)
                    os.killpg(job.pid, signal.SIGCONT)
                except OSError:
                    pass
        elif os.WIFCONTINUED(status):
            tell('continued')
        elif os.WIFEXITED(status):
            tell('exited %d' % os.WEXITSTATUS(status))
            os._exit(0)
        elif os.WIFSIGNALED(status):
            tell('killed %d' % os.WTERMSIG(status))
            os._exit(0)

# The driver: relays the pty and the shell's events, and runs the steps.
os.close(told_w)
os.close(asked_r)
job = None
stopped = 0
continued = 0
out = b''
told = b''
start = time.time()
due = start + steps[0][0] / 1000 if steps else None
at = 0
open_fds = [fd, told_r]

def heard(chunk):
    global job, stopped, continued, told
    told += chunk
    lines = told.split(b'\n')
    told = lines.pop()
    for raw in lines:
        line = raw.decode()
        word = line.split()
        if word[0] == 'started':
            job = int(word[1])
            say(started=job)
        elif word[0] == 'stopped':
            stopped += 1
            say(stopped=int(word[1]))
        elif word[0] == 'continued':
            continued += 1
            say(continued=continued)
        elif word[0] == 'exited':
            say(exited=int(word[1]))
        elif word[0] == 'killed':
            say(killed=int(word[1]))

def read(which):
    global out
    try:
        chunk = os.read(which, 65536)
    except OSError:
        chunk = b''
    if not chunk:
        open_fds.remove(which)
        return
    if which == fd:
        out += chunk
        say(out=chunk.decode('utf-8', 'replace'))
    else:
        heard(chunk)

while open_fds and time.time() - start < DEADLINE:
    ready, _, _ = select.select(open_fds, [], [], 0.02)
    for which in ready:
        read(which)
    if due is not None and time.time() >= due and at < len(steps):
        step = steps[at][1]
        if step.startswith('?'):
            if step[1:].encode() not in out:
                continue
        elif step == '%fg':
            if stopped <= continued:
                continue
            os.write(asked_w, b'fg\n')
        elif step.startswith('@'):
            if job is None:
                continue
            os.kill(job, getattr(signal, step[1:]))
        else:
            os.write(fd, step.encode('latin-1'))
        at += 1
        due = time.time() + steps[at][0] / 1000 if at < len(steps) else None

# The loop ends when the shell has gone — both its fds closed — or at
# the deadline, with the job still there.
if open_fds:
    if job is not None:
        for s in (signal.SIGCONT, signal.SIGKILL):
            try:
                os.killpg(job, s)
            except OSError:
                pass
    os.kill(pid, signal.SIGKILL)
    say(timeout=True)
try:
    os.waitpid(pid, 0)
except ChildProcessError:
    pass
say(end=True)
