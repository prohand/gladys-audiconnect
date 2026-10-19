# Audi Connect

Follow your Audi cars in Gladys: battery and charging, fuel, range, mileage, locks, doors and
windows, climate and parking position. Start or stop charging and climate, set the target
charge level, lock and unlock, from Gladys, a scene or the dashboard.

The integration reads the Audi cloud (myAudi): the same data as the myAudi app.

## Before you start

- A **myAudi account** with your car added, and the Audi connect services active (as in the
  myAudi app).
- An account created in **Europe** or in **Canada**. Accounts from the United States and China
  are not supported.
- Optional: your **S-PIN** (4-digit security PIN of myAudi), only to lock and unlock from Gladys.
- Some values and commands depend on the car and on its connect contract: a car that does not
  report a value simply gets no feature for it.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Choose your **Market**: Europe (every European country) or Canada. Save.
3. Click **Connect** next to **myAudi account**. An Audi page opens: sign in with your myAudi
   account and approve the code shown. The configuration screen shows the same code while it
   waits (10 minutes at most).
4. Once approved, the status turns to connected and your cars appear in the **Discovery** tab:
   add them.
5. Optional: fill in your **S-PIN** to lock and unlock from Gladys.
6. Optional: change the **Refresh interval**, 15 minutes by default (5 minutes to 1 hour).

Why no password? Audi no longer lets third-party apps sign in with a password. The sign-in on
the Audi page is the method Audi still accepts. The integration keeps the sign-in (a token,
stored by Gladys, never shown) and renews it by itself: you only connect once.

## What each car shows

| Feature                   | Cars                 | Control                      |
| ------------------------- | -------------------- | ---------------------------- |
| Mileage                   | all                  |                              |
| Battery level             | electric and hybrid  |                              |
| Electric range            | electric and hybrid  |                              |
| Range                     | petrol, diesel, PHEV |                              |
| Fuel level                | petrol, diesel, PHEV |                              |
| Charging                  | electric and hybrid  | start / stop                 |
| Plugged in                | electric and hybrid  |                              |
| Charging power            | electric and hybrid  |                              |
| Charging time left        | electric and hybrid  |                              |
| Target charge level       | electric and hybrid  | 20 to 100 %                  |
| Climate                   | when supported       | start / stop                 |
| Climate temperature       | when supported       | used at the next start       |
| Locked                    | all                  | lock / unlock (S-PIN needed) |
| Door open, Window open    | all                  |                              |
| Service due in (days, km) | when reported        | negative when overdue        |
| Parking position          | when shared          | latitude, longitude          |

A badge on each car shows **cloud** when the last read worked, **unreachable** when it failed.

Commands take time: the car receives the order through the Audi cloud and carries it out within
a minute. Gladys shows the new state once the car confirmed it, and the car is read again 20
seconds later.

## Configuration buttons

- **Test the connection**: signs in again, lists your cars and the calls left for today.
- **Refresh a car now**: reads a car at once. Tick **Wake the car up** to ask the car itself for
  fresh values (up to 2 minutes; it uses the car's 12 V battery, so not too often).
- **Flash the lights**: the car flashes its lights for 10 seconds, to find it in a car park
  (needs its parking position).

## Scenes

The integration adds its own cards to the scene editor (Gladys 5.1 or later).

Triggers:

- **Charging state changed**: charging, finished (target reached), not charging, error. Filter
  on a car and on the new state. Variables: car name, state, battery level, range.
- **Car locked or unlocked**: the lock state changed between two reads. Variables: car name,
  state (`locked` / `unlocked`).
- **A car command failed**: the car or the Audi cloud refused an order (lock, charging,
  climate…). Variables: car name, command, reason (`spin_missing`, `spin_refused`, `failed`,
  `error`…), message.

Actions:

- **Start the climate of a car**, with an optional temperature (16 to 30 °C; empty: the car's
  own settings). Outputs: start accepted, confirmed by the car.
- **Stop the climate of a car**. Outputs: stop accepted, confirmed by the car.
- **Read a car now**, optionally waking it up. Outputs: battery level, range, fuel level,
  mileage, locked, charging, plugged in, climate on — usable by the next actions.

Example: "every weekday at 7:30, if the battery is below 30 %, start charging; at 7:45 start the
climate at 21 °C".

## Dashboard

Add the **Audi car** widget and pick the car (the first one when left empty). It shows the
battery (or fuel) gauge, range and mileage live, the locks, doors and windows, charging and
climate, the time of the last report, and buttons: refresh, start/stop climate, lock (never
unlock from a dashboard), and a map link to the parking position.

## Limits

- Audi limits the number of calls per account and per day. Each read of a car costs two calls:
  keep the refresh interval at 15 minutes or more if you have several cars. **Test the
  connection** tells how many calls are left today.
- The values are those the car last sent to the cloud. A parked, sleeping car sends nothing:
  use **Wake the car up** when you need fresh values.

## Troubleshooting

- **"No myAudi account linked"**: click **Connect** and approve the code on the Audi page.
- **"Audi refused the stored sign-in"**: the link was revoked (password changed in myAudi,
  account removed…). Click **Connect** again.
- **Lock or unlock fails** with `spin_missing` / `spin_refused`: fill in the right S-PIN.
- **A value is missing**: the car does not report it, or the service is not part of its connect
  contract. Check in the myAudi app.
- Turn on **Detailed logs** in the configuration, reproduce the problem, then read the
  integration logs. E-mail, passwords, tokens and the S-PIN are never logged.
