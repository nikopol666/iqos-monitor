# User guide

What is on each page and how to drive it. The web app has three pages plus
settings; the agent lives in the Windows tray.

## Overview (`/`)

The page of one person. When several people exist, chips at the top switch
between them (plus *All*, which also shows unassigned devices); the choice is
remembered by the browser.

- **Connected now**: every device of that person that is plugged into a PC
  with the agent right now. The card shows the product render with a live
  battery bar (bolt while charging), battery state, sticks today, puffs today
  and puffs per stick today; underneath the lifetime counters, usage hours and
  LED brightness. A running archive transfer shows progress, percentage and
  the estimated time left. Click the card to open the device page.
- **This week**: sticks today (with yesterday), puffs per stick today,
  sticks per day this week (with the total and last week), puffs per stick
  this week.
- **Last 7 full days**: sticks per day and puffs per stick for the last seven
  completed days, per device. The *Include today* switch adds the running day;
  the card then says *Last 7 days*.
- **All devices**: the same cards for the person's devices that are not
  connected. Battery, charging and brightness are not shown while a device is
  away because they change in the meantime; the card shows when it was last
  connected instead.

The header shows the connected devices as small chips with battery and
charging state, a transfer indicator while records are being read, the theme
switch (system / light / dark) and the language.

## Statistics (`/stats`)

**View** chooses how you look at time:

- **Day**, **Week**, **Month**: calendar periods. Arrows page backwards and
  forwards (never into the future), *Today* jumps back. Day is midnight to
  midnight and charts by hour; week runs from the configured week start;
  month is the calendar month. Clicking a day in the week or month view opens
  that day; clicking an hour in the day view lists the records of that hour.
- **Range**: presets (7 days, 30 days, 3 months, 1 year, all) or custom
  dates, with your own grouping by day, week or month. Clicking a bar zooms
  one level finer; *Back* returns.

**Who**: the person and the device, as buttons. The legend under the filters
hides a device from the charts with one click and filters to it with a
double click. *Also show records with a suspicious clock* includes records
whose device clock looks wrong (more than 30 days between neighbouring
archive ids); they are hidden by default.

**Numbers** (always for the chosen period): sticks per day, puffs per stick,
sticks, puffs and the average stick duration (from the start of heating to
the last puff), each with the change against the previous period of the same
length and a line of context (per active day, days with data, first puff
after N seconds, whole session length).

**Charts**: sticks per day/week/month stacked by device with the average line
and a value on every column that is wide enough; puffs per stick as lines per
device with the overall average; sticks by hour of the day and by weekday
(counts for the period, the per-day figure in the tooltip). Hover for the
exact values; click to zoom or to list records.

**Table by period** (collapsed at the bottom): sticks, puffs, puffs per
stick, duration, sticks per day and the raw record count per bucket; a row
opens the same drill-down as the chart.

## Device page (`/devices/<serial>`)

- **Header**: render, name (model and finish unless you named it), owner,
  connection state and a warning when the archive contains a clock jump.
- **Diagnostics**: model, serial, firmware, battery, charging, temperature,
  LED brightness, lifetime sticks (heating starts), puffs, average puffs per
  stick, usage hours, error code and the two raw sensors. Rows without a mark
  are verified; *to verify* and *unknown meaning* say what is still open and
  the tooltip on the mark explains why. Live values are shown only while the
  device is connected.
- **Archive**: which archive ids the server holds and the *Download full
  history* button. The agent reads every id down to zero in the background
  while the device stays connected; the card shows progress, percentage and
  time left and the download can be cancelled; unplugging pauses it and the
  next connection continues. Deleted records come back with a full download,
  blocked ones never.
- **Device settings** (only while connected): LED brightness (low / high),
  FlexPuff, AutoStart, Smart Gesture and the four vibration events as
  switches; *Lock device* / *Unlock device* with the current state, *Find my
  IQOS* (vibrates; *Stop* ends it) and *Restart device* (asks first; the
  device drops off USB for a few seconds). Each change is sent by the agent,
  read back from the device and reported underneath. The raw event log of the
  device is available folded at the bottom.
- **Faulty records**: records with an invalid status or a suspicious clock.
  *Delete* removes the record; the agent does not read it again by itself,
  only a full history download brings it back. *Block* removes it for good.
  Removed ids are listed with *Restore*.
- **Archive records**: every record with time, puffs, time to the last puff
  and status; *Show invalid records* adds empty reads, timeouts and CRC
  errors. **Live changes** lists the last live samples (battery, charging and
  counters whenever they changed).

## Settings (`/settings`)

- **People**: add, rename, recolour, delete. A person groups devices on the
  overview and in the statistics filters.
- **Devices**: for every device its owner, an optional name, the model and
  finish (which picks the render) and the chart colour. *Reset* returns the
  colour to the finish's default; the page warns when a colour reads badly in
  one of the themes.
- **Agents**: generate API keys for agents (shown once), see when each agent
  last reported and from which PC. A fixed `AGENT_API_KEY` in the container
  environment is accepted as well.
- **Display**: the day the week starts on (by language, Monday, Saturday or
  Sunday), stored in the browser.
- **Language**: browser default, English or Czech, stored in the browser.

## The agent (Windows tray)

The tray icon is grey without a device, green with a device connected, blue
during a transfer and red when the server is unreachable. Its menu shows the
devices with battery and transfer state, opens the web app, opens *Settings*
(server address, API key, agent name, language, automatic updates), checks
for updates on demand and toggles *Start with Windows*. The first start opens
the settings window with a *Test* button.

With automatic updates on, the agent checks the latest GitHub release once a
day and installs it by itself: download, size and digest check, file swap,
restart. The tray menu's *Check for updates…* does the same immediately.

The agent accepts any IQOS over USB. On connect it takes a diagnostics
snapshot, reads the archive records the server lacks (the last three months
on first contact) and streams the live state once a second; while the device
stays plugged in it checks for new records every five seconds. Jobs from the
web (full history download, setting changes) run in the background. The
agent stores nothing on the PC apart from its settings and a log.
