# Security policy

## Supported versions

Only the latest release of the Audi Connect integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-audiconnect](https://github.com/prohand/gladys-audiconnect/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove e-mail addresses, passwords, S-PIN, tokens and VINs first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), the myAudi
account, the Audi / VW Group cloud services and the vehicles themselves.

## What the integration holds

- Your myAudi e-mail, password and S-PIN are stored by Gladys in the integration's
  configuration (password and S-PIN in secret fields). The integration never logs them.
- The access tokens the Audi cloud issues are kept in memory only: nothing is written to disk,
  a restart signs in again.
- The integration only talks to the Audi / VW Group servers over HTTPS. It opens no port.

## Good practices for users

- Use a myAudi account password you do not use anywhere else.
- Leave the S-PIN empty if you do not need to lock or unlock the car from Gladys: without it,
  the integration cannot unlock the vehicle.
- Keep Gladys and the integration up to date.
