import prisma from "@/lib/prisma";
import { BookingProvider } from "./_components/BookingContext";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import BookingFlow from "./_components/BookingFlow";
import Link from "next/link";

export const dynamic = 'force-dynamic';

export default async function BookPage() {
    const session = await getServerSession(authOptions);
    const [services, employees, settings, schedules, irregularSchedules] = await Promise.all([
        prisma.service.findMany({ orderBy: { createdAt: "asc" } }),
        prisma.user.findMany({
            where: { role: "EMPLOYEE" },
            orderBy: { createdAt: "asc" },
        }),
        prisma.settings.findFirst(),
        prisma.schedule.findMany(),
        prisma.irregularSchedule.findMany(),
    ]);

    const slotDurationMinutes = settings?.appointmentDuration ?? 30;

    return (
        <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-color)" }}>
            {/* Simple Header for booking flow */}
            <header style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
                <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Link href="/" style={{ textDecoration: 'none' }}>
                        <h1 style={{ fontSize: "clamp(1rem, 4vw, 1.5rem)", color: "var(--accent)", margin: 0, cursor: "pointer", whiteSpace: "nowrap" }}>
                            Brica Barbershop Booking
                        </h1>
                    </Link>
                </div>
            </header>

            <main>
                <BookingProvider>
                    <BookingFlow 
                        services={services} 
                        employees={employees} 
                        slotDurationMinutes={slotDurationMinutes}
                        schedules={JSON.parse(JSON.stringify(schedules))}
                        irregularSchedules={JSON.parse(JSON.stringify(irregularSchedules))}
                        currentUser={{ id: session?.user?.id, role: session?.user?.role }}
                    />
                </BookingProvider>
            </main>
        </div>
    );
}
