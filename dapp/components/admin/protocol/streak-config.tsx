"use client";

import React from "react";
import { UseFormReturn } from "react-hook-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export interface StreakConfigFormValues {
  streak_bonus_interval: bigint;
  streak_bonus_amount: bigint;
}

interface StreakConfigProps {
  form: UseFormReturn<StreakConfigFormValues>;
  pendingChanges?: boolean;
  ChangeIndicator?: React.FC<{ hasChanged: boolean }>;
}

export function StreakConfig({
  form,
  pendingChanges,
  ChangeIndicator,
}: StreakConfigProps) {
  return (
    <Card className={pendingChanges ? "border-purple-500" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center">
          Streak Bonus Configuration
          {ChangeIndicator && <ChangeIndicator hasChanged={!!pendingChanges} />}
        </CardTitle>
        <CardDescription>
          Configure recurring bonus rewards for users maintaining activity
          streaks.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="streak_bonus_interval"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bonus Interval (seconds)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      value={field.value?.toString() ?? "0"}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw === "") {
                          field.onChange(0n);
                          return;
                        }
                        const numeric = Number(raw);
                        if (Number.isNaN(numeric)) {
                          return;
                        }
                        const clamped = Math.max(0, Math.floor(numeric));
                        field.onChange(BigInt(clamped));
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    Minimum time between bonus streak rewards in seconds. For
                    weekly bonuses use <code>604800</code>.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="streak_bonus_amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bonus Amount (points)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      value={field.value?.toString() ?? "0"}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw === "") {
                          field.onChange(0n);
                          return;
                        }
                        const numeric = Number(raw);
                        if (Number.isNaN(numeric)) {
                          return;
                        }
                        const clamped = Math.max(0, Math.floor(numeric));
                        field.onChange(BigInt(clamped));
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    Number of additional points awarded each time the streak
                    interval is satisfied.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}
