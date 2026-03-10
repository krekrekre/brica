"use client";

import { useBooking } from "./BookingContext";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { Service } from "@prisma/client";
import { format } from "date-fns";
import { X, Clock, User as UserIcon, Calendar, Check } from "lucide-react";
import styles from "./BookingModal.module.css";

interface Props {
    services: Service[];
}

export default function BookingModal({ services }: Props) {
    const { state, setTimeSlot, setService, resetBooking } = useBooking();
    const router = useRouter();
    const { data: session } = useSession();
    const [isPending, setIsPending] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [error, setError] = useState("");

    const isOpen = !!state.selectedTimeSlot || isSuccess;

    const aptDate = useMemo(() => {
        if (!state.selectedTimeSlot) return null;
        return new Date(state.selectedTimeSlot.time);
    }, [state.selectedTimeSlot]);

    const maxDuration = state.selectedTimeSlot?.maxDuration ?? 0;

    // Auto-select first available service if none selected
    useEffect(() => {
        if (isOpen && !state.selectedService && services.length > 0 && !isSuccess) {
            const firstFit = services.find(s => s.duration <= maxDuration);
            if (firstFit) {
                setService(firstFit);
            }
        }
    }, [isOpen, state.selectedService, services, maxDuration, setService, isSuccess]);

    const handleClose = () => {
        if (isSuccess) {
            resetBooking();
            setIsSuccess(false);
        } else {
            setTimeSlot(null);
            setService(null);
        }
        setError("");
    };

    const handleConfirm = async () => {
        if (!state.selectedService) {
            setError("Molimo izaberite uslugu.");
            return;
        }

        if (!session) {
            signIn(undefined, { callbackUrl: "/book" });
            return;
        }

        setIsPending(true);
        setError("");

        try {
            const res = await fetch("/api/booking/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    employeeId: state.selectedEmployee?.id,
                    serviceId: state.selectedService.id,
                    startTime: state.selectedTimeSlot?.time,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Greška pri zakazivanju.");
            }

            // Success
            setIsSuccess(true);
            setIsPending(false);
            router.refresh();

        } catch (err: any) {
            setError(err.message || "Došlo je do neočekivane greške.");
            setIsPending(false);
        }
    };

    // Auto-close success modal after 2 seconds
    useEffect(() => {
        if (isSuccess) {
            const timer = setTimeout(() => {
                handleClose();
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [isSuccess]);

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={handleClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                {isSuccess ? (
                    <div className={styles.successView}>
                        <div className={styles.successIcon}>
                            <Check size={40} />
                        </div>
                        <h2 className={styles.successTitle}>Uspešno!</h2>
                        <p className={styles.successText}>
                            Vaš termin je uspešno zakažen. Detalje možete pogledati na Vašem profilu.
                        </p>
                        <button className={styles.successAction} onClick={handleClose}>
                            Zatvori
                        </button>
                    </div>
                ) : (
                    <>
                        <header className={styles.header}>
                            <h2 className={styles.title}>Kompletirajte rezervaciju</h2>
                            <button className={styles.closeBtn} onClick={handleClose} aria-label="Zatvori">
                                <X size={20} />
                            </button>
                        </header>

                        <div className={styles.body}>
                            <div className={styles.infoSection}>
                                <div className={styles.infoItem}>
                                    <div className={styles.infoIcon}>
                                        <UserIcon size={20} />
                                    </div>
                                    <div>
                                        <span className={styles.infoLabel}>Berber</span>
                                        <span className={styles.infoValue}>{state.selectedEmployee?.name}</span>
                                    </div>
                                </div>
                                <div className={styles.infoItem}>
                                    <div className={styles.infoIcon}>
                                        <Calendar size={20} />
                                    </div>
                                    <div>
                                        <span className={styles.infoLabel}>Datum i vreme</span>
                                        <span className={styles.infoValue}>
                                            {aptDate && format(aptDate, "EEEE, d. MMMM yyyy.")} u {aptDate && format(aptDate, "HH:mm")}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <h3 className={styles.sectionTitle}>Izaberite uslugu</h3>
                            <div className={styles.serviceList}>
                                {services.map((service) => {
                                    const isSelected = state.selectedService?.id === service.id;
                                    const canFit = service.duration <= maxDuration;

                                    return (
                                        <button
                                            key={service.id}
                                            className={`${styles.serviceOption} ${isSelected ? styles.selected : ""} ${!canFit ? styles.disabled : ""}`}
                                            onClick={() => canFit && setService(service)}
                                            disabled={!canFit}
                                        >
                                            <div className={styles.serviceMain}>
                                                <span className={styles.serviceTitle}>{service.title}</span>
                                                <span className={styles.serviceMeta}>⏱ {service.duration} min</span>
                                            </div>
                                            <div className={styles.servicePrice}>
                                                {service.price.toFixed(0)} RSD
                                                {isSelected && <Check size={18} style={{ marginLeft: '8px', verticalAlign: 'middle' }} />}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {error && <div className={styles.error}>{error}</div>}
                        </div>

                        <footer className={styles.footer}>
                            <button 
                                className={styles.confirmBtn} 
                                onClick={handleConfirm}
                                disabled={isPending || !state.selectedService}
                            >
                                {!session 
                                    ? "Prijavite se za potvrdu" 
                                    : isPending 
                                        ? "Čuvanje..." 
                                        : "Potvrdi termin"}
                            </button>
                        </footer>
                    </>
                )}
            </div>
        </div>
    );
}
