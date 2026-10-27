import { Stack, useLocalSearchParams } from "expo-router";
import { RefreshControl, SectionList, Text, View } from "react-native";
import { useTrip } from "@golaly/client/react";
import type { ItemView } from "@golaly/shared";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { dayColor } from "@golaly/tokens";
import { Button, Centered, Loading } from "@/components/ui";

function Stop({ item }: { item: ItemView }) {
  const { colors } = useTheme();
  const time = item.startTime ? item.startTime.slice(0, 5) : null;
  const where = item.place ? [item.place.name, item.place.areaName ?? item.place.destinationName].filter(Boolean).join(" · ") : null;
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingVertical: 10, paddingHorizontal: 16, opacity: item.status === "SKIPPED" ? 0.5 : 1 }}>
      <Text style={{ width: 48, color: colors.muted, fontVariant: ["tabular-nums"] }}>{time ?? "·"}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "600", textDecorationLine: item.status === "SKIPPED" ? "line-through" : "none" }}>{item.title}</Text>
        {where && where !== item.title ? (
          <Text style={{ color: colors.ink2 }} numberOfLines={1}>
            {where}
          </Text>
        ) : null}
        {item.notes ? (
          <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={2}>
            {item.notes}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The itinerary, read-only for now: day by day, then the ideas not on a day yet. */
export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { colors } = useTheme();
  const trip = useTrip(id);

  if (trip.isPending) return <Loading />;
  if (trip.isError)
    return (
      <Centered>
        <Text style={{ color: colors.ink2, textAlign: "center" }}>{trip.error.message || t.loadFailed}</Text>
        <Button kind="secondary" title={t.retry} onPress={() => trip.refetch()} />
      </Centered>
    );

  const d = trip.data;
  const sections = [
    ...d.days.map((day) => ({ key: day.id, title: `${t.day(day.dayNumber)}${day.date ? ` · ${day.date}` : ""}${day.title ? ` — ${day.title}` : ""}`, color: dayColor(day.dayNumber), data: day.items })),
    ...(d.pool.length ? [{ key: "pool", title: t.ideas, color: colors.muted, data: d.pool }] : []),
  ];

  return (
    <>
      <Stack.Screen options={{ title: d.title }} />
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        refreshControl={<RefreshControl refreshing={trip.isRefetching} onRefresh={() => void trip.refetch()} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 4 }}>
            {d.route ? <Text style={{ color: colors.ink2, fontSize: 15 }}>{d.route}</Text> : null}
            <Text style={{ color: colors.muted }}>
              {t.dates(d.startDate, d.endDate)} · {t.members(d.members.length)}
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.sand }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: section.color }} />
            <Text accessibilityRole="header" style={{ color: colors.ink, fontWeight: "700", fontSize: 15 }}>
              {section.title}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{t.stops(section.data.length)}</Text>
          </View>
        )}
        renderItem={({ item }) => <Stop item={item} />}
        renderSectionFooter={({ section }) => (section.data.length === 0 ? <Text style={{ color: colors.muted, paddingHorizontal: 16, paddingBottom: 8 }}>{t.noStops}</Text> : null)}
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    </>
  );
}
