# Road route choices

The planner requests `alternatives=3` from the public OSRM driving service.
This requests the primary route plus up to three alternatives. The former
`alternatives=true` requested only one alternative; server and browser code
also previously capped the accepted list at three. Four distinct valid route
geometries can now be displayed, selected on the map or in the route cards,
and restored after reload. Duplicate geometry is omitted.

The public server currently rejects requests above three alternatives.
It can return fewer options, including only one. This is not an exhaustive
list of all possible roads or detours. The UI reports the returned count.

Choose **Add a via place** to search for a road/town or pick a point on the
map. Routes are requested through that point in start/via/destination order.
The via marker appears in planning and navigation; route details disclose
the gap from the chosen point to the returned road geometry. Removing or
changing the via point recalculates choices and clears the previous route
selection. Opening and cancelling an empty via field keeps the selection.

**Refresh routes** refreshes an existing saved plan, including older plans
with only two options. Route and via edits are disabled while a journey is
armed or active. Existing saved journeys without a via field still restore.
Journey start/arrival timing continues to use the start and destination.

The public API accepts `{ start, end, via? }` with latitude/longitude points.
The browser sends coordinates only, without place labels or device secrets.
Existing same-origin checks, fixed upstream, timeouts, byte/geometry limits
and no-store responses remain. Via points must differ from both endpoints;
returned routes must pass within 500 m of all selected points. No generated
straight lines or invented road alternatives are used.

Build, ten verification rounds, browser regression checks, and real provider
receipts: [ROUTE_OPTIONS_VERIFICATION.json](ROUTE_OPTIONS_VERIFICATION.json).
