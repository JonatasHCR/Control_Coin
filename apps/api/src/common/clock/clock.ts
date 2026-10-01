/**
 * The clock is injected, never read from the ambient environment.
 *
 * BR14 excludes the running month, BR19 splits past from future at "now", and
 * installment dates walk forward from a purchase — so a suite run on the 1st
 * must behave exactly like one run on the 28th (ARCH02).
 */
export abstract class Clock {
  abstract today(): string;
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
  today(): string {
    return this.now().toISOString().slice(0, 10);
  }
}

/** Test double. Never used outside tests and seeds. */
export class FixedClock extends Clock {
  constructor(private readonly instant: string) {
    super();
  }
  now(): Date {
    return new Date(`${this.instant}T12:00:00Z`);
  }
  today(): string {
    return this.instant;
  }
}
