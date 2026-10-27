import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Link, Stack } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useMyTrips } from "@golaly/client/react";
import type { TripSummary } from "@golaly/shared";
import { logOut } from "@/lib/auth";
import { absoluteUrl } from "@/lib/config";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button, Centered, Loading } from "@/components/ui";

function TripCard({ trip }: { trip: TripSummary }) {
  const t = useT();
  const { colors, radius } = useTheme();
  const cover = absoluteUrl(trip.coverImage?.thumbUrl ?? trip.coverUrl);
  return (
    <Link href={{ pathname: "/trips/[id]", params: { id: trip.id } }} asChild>
      <Pressable accessibilityRole="button" style={({ pressed }) => ({ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, overflow: "hidden", opacity: pressed ? 0.85 : 1 })}>
        <View style={{ height: 120, backgroundColor: trip.coverImage?.color ?? trip.cover[0] }}>
          {cover ? <Image source={{ uri: cover }} style={{ flex: 1 }} contentFit="cover" transition={150} accessibilityIgnoresInvertColors /> : null}
        </View>
        <View style={{ padding: 14, gap: 4 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }} numberOfLines={2}>
            {trip.title}
          </Text>
          {trip.route ? (
            <Text style={{ color: colors.ink2 }} numberOfLines={1}>
              {trip.route}
            </Text>
          ) : null}
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {t.dates(trip.startDate, trip.endDate)}
            {trip.myRole ? ` · ${t.roles[trip.myRole] ?? trip.myRole}` : ""}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

export default function MyTrips() {
  const t = useT();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const trips = useMyTrips("all");

  const header = (
    <Stack.Screen
      options={{
        title: t.myTrips,
        headerLargeTitle: true,
        headerRight: () => (
          <Pressable accessibilityRole="button" onPress={() => logOut(qc)} hitSlop={12}>
            <Text style={{ color: colors.primary, fontSize: 16 }}>{t.logOut}</Text>
          </Pressable>
        ),
      }}
    />
  );

  if (trips.isPending)
    return (
      <>
        {header}
        <Loading />
      </>
    );
  if (trips.isError && !trips.items)
    return (
      <>
        {header}
        <Centered>
          <Text style={{ color: colors.ink2, textAlign: "center" }}>{t.loadFailed}</Text>
          <Button kind="secondary" title={t.retry} onPress={() => trips.refetch()} />
        </Centered>
      </>
    );

  return (
    <>
      {header}
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={trips.items ?? []}
        keyExtractor={(trip) => trip.id}
        renderItem={({ item }) => <TripCard trip={item} />}
        contentContainerStyle={{ padding: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={trips.isRefetching && !trips.isFetchingNextPage} onRefresh={() => void trips.refetch()} tintColor={colors.primary} />}
        onEndReached={() => trips.hasNextPage && !trips.isFetchingNextPage && trips.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={trips.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : undefined}
        ListEmptyComponent={
          <View style={{ paddingVertical: 64, gap: 8, alignItems: "center" }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>{t.noTrips}</Text>
            <Text style={{ color: colors.ink2, textAlign: "center" }}>{t.noTripsBody}</Text>
          </View>
        }
      />
    </>
  );
}
