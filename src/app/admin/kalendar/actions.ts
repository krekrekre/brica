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

export async function createAppointmentByAdmin(formData: {
    userId?: string | null;
    employeeId: string;
    serviceId?: string | null;
    isPause?: boolean;
    duration?: number;
    startTime: string; // ISO string
}) {
    await checkAdmin();

    const { userId, employeeId, serviceId, isPause, duration, startTime } = formData;
    if (!employeeId || !startTime || (!serviceId && !isPause)) {
        throw new Error("Missing required fields.");
    }

    const start = new Date(startTime);
    let end: Date;

    if (isPause) {
        const dur = duration || 30; // Default 30 min for pause if not specified
        end = new Date(start.getTime() + dur * 60000);
    } else {
        if (!serviceId) throw new Error("Izaberite uslugu.");
        const service = await prisma.service.findUnique({ where: { id: serviceId } });
        if (!service) throw new Error("Usluga nije pronađena.");
        end = new Date(start.getTime() + service.duration * 60000);
    }

    const conflict = await prisma.appointment.findFirst({
        where: {
            employeeId,
            status: "CONFIRMED",
            OR: [
                { startTime: { lte: start }, endTime: { gt: start } },
                { startTime: { lt: end }, endTime: { gte: end } },
                { startTime: { gte: start }, endTime: { lte: end } },
            ],
        },
    });
    if (conflict) throw new Error("Termin se preklapa sa postojećom rezervacijom.");

    await prisma.appointment.create({
        data: {
            user: userId ? { connect: { id: userId } } : undefined,
            employee: { connect: { id: employeeId } },
            service: isPause ? undefined : { connect: { id: serviceId as string } },
            isPause: !!isPause,
            startTime: start,
            endTime: end,
            status: "CONFIRMED",
        },
    });

    revalidatePath("/admin/kalendar");
}

export async function cancelAppointment(id: string) {
    await checkAdmin();

    const appointment = await prisma.appointment.findUnique({
        where: { id },
    });
    if (!appointment) throw new Error("Zakazivanje nije pronađeno.");
    if (appointment.status === "CANCELLED") return;

    await prisma.appointment.update({
        where: { id },
        data: { status: "CANCELLED" },
    });

    revalidatePath("/admin/kalendar");
}

export async function createIrregularSchedulesBatch(
    employeeId: string,
    entries: { startDate: string; endDate: string; startTime: string; endTime: string }[]
) {
    await checkAdmin();

    await prisma.irregularSchedule.createMany({
        data: entries.map(e => {
            const [sy, sm, sd] = e.startDate.split("-").map(Number);
            const [ey, em, ed] = e.endDate.split("-").map(Number);
            return {
                employeeId,
                startDate: new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0)),
                endDate: new Date(Date.UTC(ey, em - 1, ed, 0, 0, 0)),
                startTime: e.startTime,
                endTime: e.endTime,
            };
        }),
    });

    revalidatePath("/admin/schedule");
    revalidatePath("/admin/kalendar");
}

export async function createTimeOffBatch(
    employeeId: string,
    dates: string[], // ISO strings yyyy-mm-dd
    reason: string
) {
    await checkAdmin();

    await prisma.$transaction(async (tx) => {
        for (const dateStr of dates) {
            const [y, m, d] = dateStr.split("-").map(Number);
            const dObj = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
            
            await tx.timeOff.upsert({
                where: {
                    employeeId_date: {
                        employeeId,
                        date: dObj,
                    },
                },
                update: { reason },
                create: {
                    employeeId,
                    date: dObj,
                    reason,
                },
            });
        }
    });

    revalidatePath("/admin/schedule");
    revalidatePath("/admin/kalendar");
}
