"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

async function checkAdmin() {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "ADMIN") {
        throw new Error("Unauthorized");
    }
}

/** One period is { dayOfWeek, startTime, endTime }. Multiple periods per day allowed. */
export async function updateSchedule(
    employeeId: string,
    periods: { dayOfWeek: number; startTime: string; endTime: string }[]
) {
    await checkAdmin();

    await prisma.$transaction(async (tx) => {
        await tx.schedule.deleteMany({
            where: { employeeId },
        });

        if (periods.length > 0) {
            await tx.schedule.createMany({
                data: periods.map((p) => ({
                    employeeId,
                    dayOfWeek: p.dayOfWeek,
                    startTime: p.startTime,
                    endTime: p.endTime,
                })),
            });
        }
    });

    revalidatePath("/admin/schedule");
}

// --- Irregular schedule (specific date or date range) ---

export type IrregularScheduleEntry = {
    id: string;
    startDate: Date;
    endDate: Date;
    startTime: string;
    endTime: string;
};

export async function getIrregularSchedules(employeeId: string): Promise<IrregularScheduleEntry[]> {
    await checkAdmin();
    const rows = await prisma.irregularSchedule.findMany({
        where: { employeeId },
        orderBy: { startDate: "asc" },
    });
    return rows.map((r) => ({
        id: r.id,
        startDate: r.startDate,
        endDate: r.endDate,
        startTime: r.startTime,
        endTime: r.endTime,
    }));
}

export async function createIrregularSchedule(
    employeeId: string,
    data: { startDate: Date; endDate: Date; startTime: string; endTime: string }
) {
    await checkAdmin();
    if (data.startDate > data.endDate) {
        throw new Error("Start date must be before or equal to end date.");
    }
    await prisma.irregularSchedule.create({
        data: {
            employeeId,
            startDate: data.startDate,
            endDate: data.endDate,
            startTime: data.startTime,
            endTime: data.endTime,
        },
    });
    revalidatePath("/admin/schedule");
}

export async function deleteIrregularSchedule(employeeId: string, id: string) {
    await checkAdmin();
    
    // Find the entry first to get dates/times
    const entry = await prisma.irregularSchedule.findUnique({
        where: { id, employeeId },
    });
    
    if (!entry) return;

    // Check for appointments in this span
    // We construct the span (very rough check is fine for safety)
    const appointments = await prisma.appointment.findMany({
        where: {
            employeeId,
            status: { in: ["CONFIRMED", "PENDING"] },
            startTime: { lt: entry.endDate },
            endTime: { gt: entry.startDate },
        },
    });

    if (appointments.length > 0) {
        throw new Error("Cannot delete schedule with booked appointments.");
    }
    
    await prisma.irregularSchedule.deleteMany({
        where: { id, employeeId },
    });
    revalidatePath("/admin/schedule");
}

// --- Time off (neradni dani) ---

export async function getTimeOffs(employeeId: string) {
    await checkAdmin();
    return await prisma.timeOff.findMany({
        where: { employeeId },
        orderBy: { date: "asc" },
    });
}

export async function createTimeOff(employeeId: string, date: Date, reason: string) {
    await createTimeOffBatch(employeeId, [date], reason);
}

export async function createTimeOffBatch(
    employeeId: string,
    dates: Date[],
    reason: string,
    applyToAll: boolean = false
): Promise<{ id: string; date: Date; reason: string | null }[]> {
    await checkAdmin();

    const saved: { id: string; date: Date; reason: string | null }[] = [];

    const targetEmployeeIds = applyToAll
        ? (await prisma.user.findMany({ where: { role: "EMPLOYEE" }, select: { id: true } })).map((e) => e.id)
        : [employeeId];

    await prisma.$transaction(async (tx) => {
        for (const targetId of targetEmployeeIds) {
            for (const date of dates) {
                const d = new Date(date);
                d.setUTCHours(0, 0, 0, 0);
                const row = await tx.timeOff.upsert({
                    where: {
                        employeeId_date: {
                            employeeId: targetId,
                            date: d,
                        },
                    },
                    update: { reason },
                    create: {
                        employeeId: targetId,
                        date: d,
                        reason,
                    },
                });
                if (targetId === employeeId) {
                    saved.push({ id: row.id, date: row.date, reason: row.reason });
                }
            }
        }
    });

    revalidatePath("/admin/schedule");
    revalidatePath(`/admin/schedule/${employeeId}`);
    revalidatePath("/admin/kalendar");

    return saved;
}

export async function deleteTimeOff(employeeId: string, id: string) {
    await checkAdmin();
    
    const entry = await prisma.timeOff.findUnique({
        where: { id, employeeId },
    });
    
    if (!entry) return;

    // Check for appointments on this day
    const dayStart = new Date(entry.date);
    dayStart.setUTCHours(0,0,0,0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const appointments = await prisma.appointment.findMany({
        where: {
            employeeId,
            status: { in: ["CONFIRMED", "PENDING"] },
            startTime: { gte: dayStart, lt: dayEnd }
        }
    });

    if (appointments.length > 0) {
        throw new Error("Cannot delete time-off with booked appointments on that day.");
    }

    await prisma.timeOff.deleteMany({
        where: { id, employeeId },
    });
    revalidatePath("/admin/schedule");
    revalidatePath(`/admin/schedule/${employeeId}`);
    revalidatePath("/admin/kalendar");
}
