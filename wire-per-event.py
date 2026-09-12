import io

p = "apps/backend/src/services/analytics-service.js"
s = io.open(p, encoding="utf-8").read()

# Import alongside the extras.
anchor = 'const {\n  getPlatformAddOnAnalytics,'
assert anchor in s, "extras import block not found"
s = s.replace(
    anchor,
    'const {\n  getPerEventDeepAnalytics,\n} = require("./per-event-analytics-service");\nconst {\n  getPlatformAddOnAnalytics,',
    1,
)

# Compute it after the extras, only when the caller scoped to one event.
old = """  const extras = { addOns, contingents, attendance, certificates, revenueByPurpose, velocity };
"""
new = """  const extras = { addOns, contingents, attendance, certificates, revenueByPurpose, velocity };

  /*
   * THE PER-EVENT BLOCK, COMPUTED ONLY WHEN ?eventId= NARROWED THE SCOPE.
   *
   * Seven more aggregations - arrival pattern by hour, round drop-off, team
   * size distribution, per-offer revenue, certificate coverage, the fest
   * comparison and co-registration - and every one of them is either
   * meaningless fest-wide or needs the fest as a denominator while one event is
   * the subject. Running them on every fest-wide dashboard load would be work
   * nobody asked for, so the key is ABSENT rather than null when no event is
   * chosen: absent is what tells the client not to render the per-event view.
   *
   * The funnel, the gross revenue and the daily series are passed in rather
   * than recomputed - this function has already paid for them under exactly the
   * same scope.
   */
  const perEventDeep = options.eventId
    ? await getPerEventDeepAnalytics({
        festId: fest._id,
        eventIds,
        scopedFunnel: festFunnel,
        grossRevenuePaise,
        registrationsPerDay: buildDailySeries(seriesStart, registrationsByDay, "count"),
      })
    : null;
"""
assert old in s
s = s.replace(old, new, 1)

old_return = """    ...extras,
  };
}"""
new_return = """    ...extras,
    ...(perEventDeep ? { perEventDeep } : {}),
  };
}"""
assert old_return in s
s = s.replace(old_return, new_return, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ok")
