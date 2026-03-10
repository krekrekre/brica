import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function POST(request: Request) {
    // We need the user to be authenticated to book an appointment
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { employeeId, serviceId, startTime } = body;

    if (!employeeId || !serviceId || !startTime) {
        return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    const start = new Date(startTime);

    // Get settings for booking limits
    const settings = await prisma.settings.findFirst();
    const maxBookings = settings?.maxBookingsPerMonth ?? 5;

    // Check 30-day booking limit for the user
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const userBookingsCount = await prisma.appointment.count({
        where: {
            userId,
            status: "CONFIRMED",
            startTime: { gte: thirtyDaysAgo }
        }
    });

    if (userBookingsCount >= maxBookings) {
        return NextResponse.json({ 
            error: `Dostigli ste maksimalan broj rezervacija (${maxBookings}) za period od 30 dana. Sledeću rezervaciju možete napraviti nakon što prođe 30 dana od vaših prethodnih termina.` 
        }, { status: 400 });
    }

    // 1. Get Service Duration
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
        return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    const end = new Date(start.getTime() + service.duration * 60000);

    // 2. Validate Double-Booking (Concurrency Control)
    // We use a transaction to ensure we don't double book if two people click at the exact same time
    try {
        const appointment = await prisma.$transaction(async (tx) => {
            // Check for overlapping CONFIRMED appointments for THIS employee
            const conflict = await tx.appointment.findFirst({
                where: {
                    employeeId,
                    status: "CONFIRMED",
                    OR: [
                        {
                            // New apt starts during an existing apt
                            startTime: { lte: start },
                            endTime: { gt: start },
                        },
                        {
                            // New apt ends during an existing apt
                            startTime: { lt: end },
                            endTime: { gte: end },
                        },
                        {
                            // New apt completely encapsulates an existing apt
                            startTime: { gte: start },
                            endTime: { lte: end },
                        }
                    ]
                }
            });

            if (conflict) {
                throw new Error("This time slot is no longer available.");
            }

            // 3. Create Appointment
            return await tx.appointment.create({
                data: {
                    userId,
                    employeeId,
                    serviceId,
                    startTime: start,
                    endTime: end,
                    status: "CONFIRMED",
                }
            });
        });

        return NextResponse.json({ success: true, appointment });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || "Failed to book appointment" }, { status: 400 });
    }
}
