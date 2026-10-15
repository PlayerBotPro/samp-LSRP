# Ways Players Can Make Money

This list describes the earning methods implemented in the current game mode source code. All amounts are in-game dollars.

## Jobs and activities

| Method | Payment and requirements |
| --- | --- |
| Loader work | **$25 per bag** delivered. Collect wages when ending the shift. |
| Mining | Normal ore pays **$15/kg**; rare ore pays **$90/kg**. Collect wages when ending the shift. |
| Army factory work | **$30 per completed batch**, minus **$15 per defect**. |
| Bus driving | **$80 per route checkpoint**, plus passenger fares set between **$1 and $2,000**. Requires level 2 and employment as a bus driver. |

## Faction income

| Method | Payment and requirements |
| --- | --- |
| Faction salary | Hourly payment into the bank, based on organization and rank. Players must be online and not AFK. Government organizations, gangs, and mafias have salaries. |
| Gang territory bonus | Gang members receive an extra **$100 per controlled territory** at payday. |
| Arresting wanted players | Police/FBI earn **$500 per wanted star** through `/arrest`. |
| Army ammunition deliveries | Army members earn **$75 per crate** delivered to a supported department. |
| Hospital medicine deliveries | Hospital members earn **$40 per full box**, with proportional payment for partial boxes. |
| Treating players | Hospital staff charge **$1 to $5,000** using `/medhelp`. |
| Issuing medical cards | Hospital staff at rank 6 or higher charge **$2,000 to $5,000** using `/givemedcard`. |
| Selling licenses | Driving-school staff earn money using `/selllic`. Allowed prices depend on the license; see the table below. |

### License sale prices

| License | Minimum price | Maximum price |
| --- | ---: | ---: |
| Car | $5,000 | $50,000 |
| Motorcycle | $3,000 | $30,000 |
| Aircraft | $20,000 | $150,000 |
| Boat | $10,000 | $80,000 |
| Gun | $15,000 | $100,000 |

## Gang trading

| Method | Payment and requirements |
| --- | --- |
| Selling drugs | Gang members use `/selldrug` on their own gang's territory. Transaction price: **$1 to $50,000**. |
| Selling guns | Gang members use `/sellgun` on their own gang's territory. Transaction price: **$1 to $50,000**. |

## Businesses, asset sales, and player payments

| Method | Payment and requirements |
| --- | --- |
| Owning a business | Earn from implemented customer purchases, services, and entrance fees. Withdraw business earnings through the bank. |
| Selling a business to another player | Receive the agreed sale price. Profit depends on purchase and sale prices. |
| Selling a vehicle to another player | Receive the agreed sale price. Profit depends on purchase and sale prices. |
| Paid roleplay services or gifts | Receive money from other players through `/pay` or bank transfers. |

## Other ways to receive cash

These provide cash or access to existing funds rather than generating new earnings:

- Sell a house or business back to the government.
- Sell a vehicle back to the government for its configured refund.
- Withdraw existing money from house storage or an authorized family treasury.
- Receive an administrator grant.
- New characters start with **$500**.

## Source references

- [Loader work](resources/src/modules/loader/index.ts)
- [Mining](resources/src/modules/miner/index.ts)
- [Army factory work](resources/src/modules/army-factory/index.ts)
- [Bus driving](resources/src/modules/jobs/bus/shift.ts)
- [Payday](resources/src/modules/payday/index.ts)
- [Organizations and ranks](resources/src/modules/org/catalog.ts)
- [Gang territory bonus](resources/src/modules/org/gangs.ts)
- [Arrest rewards](resources/src/modules/commands/arrest.ts)
- [Army ammunition deliveries](resources/src/modules/vehicles/army-ammo-delivery.ts)
- [Hospital medicine deliveries](resources/src/modules/vehicles/hospital.ts)
- [Treatment payments](resources/src/modules/commands/medhelp.ts)
- [Medical card payments](resources/src/modules/commands/medcard.ts)
- [License sales](resources/src/modules/commands/selllic.ts) and [price limits](resources/src/modules/auth/licenses.ts)
- [Drug sales](resources/src/modules/commands/selldrug.ts)
- [Gun sales](resources/src/modules/commands/sellgun.ts)
- [Business transactions](resources/src/modules/businesses/repository.ts)
- [Vehicle sales](resources/src/modules/vehicles/sell.ts)
- [Player cash transfers](resources/src/modules/commands/pay.ts)
- [House sales](resources/src/modules/houses/sell.ts)
- [Starting money](resources/src/modules/auth/repository.ts)
