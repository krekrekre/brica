import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");
    const dateStr = searchParams.get("date"); // ISO string like 2026-03-09
    const stepMinutes = Math.min(120, Math.max(5, parseInt(searchParams.get("stepMinutes") ?? "15", 10) || 15));

    if (!employeeId || !dateStr) {
        return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // 1. Get Employee Schedules (Regular & Irregular)
    // Use local components for querying
    const year = parseInt(dateStr.split("-")[0]);
    const month = parseInt(dateStr.split("-")[1]) - 1;
    const day = parseInt(dateStr.split("-")[2]);
    const localDay = new Date(year, month, day);
    const dayOfWeek = localDay.getDay();

    // Create boundaries for database queries (UTC)
    const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month, day, 23, 59, 59, 999);

    const [regularSchedule, irregularSchedules, timeOffs] = await Promise.all([
        prisma.schedule.findFirst({
            where: { employeeId, dayOfWeek },
        }),
        prisma.irregularSchedule.findMany({
            where: {
                employeeId,
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay },
            },
        }),
        prisma.timeOff.findMany({
            where: {
                employeeId,
                date: { gte: startOfDay, lte: endOfDay },
            },
        }),
    ]);

    // 2. If TimeOff exists, the whole day is blocked
    if (timeOffs.length > 0) {
        return NextResponse.json({ availableSlots: [] });
    }

    // 3. Collect all working ranges for this day
    const ranges: { start: number; end: number }[] = [];

    // Add regular schedule if it exists
    if (regularSchedule) {
        ranges.push({
            start: timeToMinutes(regularSchedule.startTime),
            end: timeToMinutes(regularSchedule.endTime),
        });
    }

    // Add irregular schedules
    irregularSchedules.forEach((ir) => {
        ranges.push({
            start: timeToMinutes(ir.startTime),
            end: timeToMinutes(ir.endTime),
        });
    });

    if (ranges.length === 0) {
        return NextResponse.json({ availableSlots: [] });
    }

    // 4. Get existing Appointments overlapping this day
    const existingAppointments = await prisma.appointment.findMany({
        where: {
            employeeId,
            status: { in: ["CONFIRMED", "PENDING"] },
            startTime: { lt: endOfDay },
            endTime: { gt: startOfDay },
        },
        orderBy: { startTime: 'asc' }
    });

    const availableSlots: { time: string; maxDuration: number }[] = [];

    // 5. Check slots across all working ranges
    ranges.forEach(range => {
        let currentSlotTime = new Date(year, month, day, Math.floor(range.start / 60), range.start % 60, 0, 0);
        const rangeEndTime = new Date(year, month, day, Math.floor(range.end / 60), range.end % 60, 0, 0).getTime();

        while (currentSlotTime.getTime() < rangeEndTime) {
            const isFuture = currentSlotTime.getTime() > Date.now();

            // Check if current slot falls inside an existing appointment
            const conflictingApt = existingAppointments.find(apt =>
                currentSlotTime.getTime() >= apt.startTime.getTime() &&
                currentSlotTime.getTime() < apt.endTime.getTime()
            );

            if (conflictingApt) {
                currentSlotTime = new Date(conflictingApt.endTime.getTime());
                continue;
            }

            if (isFuture) {
                // Find next limit: either end of current range or start of next appointment
                const nextApt = existingAppointments.find(apt => apt.startTime.getTime() > currentSlotTime.getTime() && apt.startTime.getTime() < rangeEndTime);
                const endTimeLimit = nextApt ? nextApt.startTime.getTime() : rangeEndTime;
                const maxDuration = Math.floor((endTimeLimit - currentSlotTime.getTime()) / 60000);

                if (maxDuration >= stepMinutes) {
                    const timeIso = currentSlotTime.toISOString();
                    if (!availableSlots.some(s => s.time === timeIso)) {
                        availableSlots.push({ time: timeIso, maxDuration });
                    }
                }
            }
            currentSlotTime = new Date(currentSlotTime.getTime() + stepMinutes * 60000);
        }
    });

    // Sort slots by time
    availableSlots.sort((a, b) => a.time.localeCompare(b.time));

    return NextResponse.json({ availableSlots });
}

function timeToMinutes(s: string): number {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
}
