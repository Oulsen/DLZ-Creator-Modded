@ The measuring stub for dsp-headroom.py (#5, Q19): dspserver's two block functions call this instead
@ of their wait loop. It waits exactly as the stock loop does (spin on bit 9 of the audio register
@ until the other buffer half is ready; r2 = the half done last, r3 = the register base, the half
@ ready comes back in r6), and times the wait with the CPU's virtual counter (CNTVCT, 24 MHz).
@ Registers: only r0, r1, r4, r5, r8 besides r6; the callers set all of them after the loop before
@ reading them, and read no flags before setting them again [static].
@
@ Counters at G (past the end of .bss; dsp-headroom.py grows the data segment to cover them):
@   +0  u64  counter at the end of the last wait
@   +8  u64  ticks waited, total
@   +16 u32  blocks
@   +20 u32  ~shortest wait, this window of 4096 blocks (inverted, so the zeroed start is "none")
@   +24 u32  ~shortest wait, the window before
@   +28 u32  TLS pointer of the thread that ran the last block (C2 and C3 both call the block functions)
@   +32 u32  thread changes

	.syntax unified
	.arm
	.equ	G, 0x303a80

	.section .cave, "ax"
	.global	cave
cave:
	mrrc	p15, 1, r0, r1, c14		@ CNTVCT: start of the wait
1:	ldr	r6, [r3, #0x28]
	mvn	r6, r6, lsr #9
	and	r6, r6, #1
	cmp	r2, r6
	beq	1b
	mrrc	p15, 1, r4, r5, c14		@ end of the wait
	sub	r0, r4, r0			@ ticks waited (a block is far below 2^32 ticks)
	movw	r8, #:lower16:G
	movt	r8, #:upper16:G
	strd	r4, r5, [r8]
	ldrd	r4, r5, [r8, #8]
	adds	r4, r4, r0
	adc	r5, r5, #0
	strd	r4, r5, [r8, #8]
	mrc	p15, 0, r4, c13, c0, 3		@ TPIDRURO: which thread
	ldr	r5, [r8, #28]
	cmp	r4, r5
	strne	r4, [r8, #28]
	ldrne	r5, [r8, #32]
	addne	r5, r5, #1
	strne	r5, [r8, #32]
	mvn	r0, r0
	ldr	r4, [r8, #20]
	cmp	r0, r4
	strhi	r0, [r8, #20]
	ldr	r1, [r8, #16]
	add	r1, r1, #1
	str	r1, [r8, #16]
	lsls	r1, r1, #20			@ every 4096 blocks a new window
	bxne	lr
	ldr	r4, [r8, #20]
	str	r4, [r8, #24]
	str	r1, [r8, #20]			@ r1 is 0 here
	bx	lr
