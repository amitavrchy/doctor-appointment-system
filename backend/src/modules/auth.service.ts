import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import { Actor } from '../common/access';
import { hash, verify, argon2id } from 'argon2';
import { createHash, createHmac, randomBytes, randomInt } from 'crypto';
import { createTransport } from 'nodemailer';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
@Injectable()
export class AuthService {
  constructor(
    private db: PrismaService,
    private jwt: JwtService,
  ) {}
  async register(input: { email: string; password: string; fullName: string }) {
    const passwordHash = await hash(input.password, { type: argon2id });
    try {
      return await this.db.user.create({
        data: {
          email: input.email.toLowerCase(),
          fullName: input.fullName,
          passwordHash,
          allergies: [],
        },
        select: { id: true, email: true, fullName: true },
      });
    } catch {
      throw new ConflictException('An account with this email already exists');
    }
  }
  async login(email: string, password: string, device: string) {
    const user = await this.db.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });
    // Use a real Argon2 computation on missing users as well.
    if (!user) {
      await hash(password, { type: argon2id });
      throw new UnauthorizedException('Email or password is incorrect');
    }
    if (!(await verify(user.passwordHash, password)))
      throw new UnauthorizedException('Email or password is incorrect');
    return this.issue(user.id, device);
  }
  async issue(userId: string, device: string) {
    const refresh = randomBytes(48).toString('base64url');
    await this.db.refreshSession.create({
      data: {
        userId,
        tokenHash: digest(refresh),
        device: device.slice(0, 200),
        expiresAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    return {
      access: this.jwt.sign(
        { sub: userId },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
      ),
      refresh,
    };
  }
  async refresh(token: string, device: string) {
    const session = await this.db.refreshSession.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: { select: { deletedAt: true } } },
    });
    if (!session || session.expiresAt < new Date() || session.user.deletedAt)
      throw new UnauthorizedException('Please sign in again');
    const consumed = await this.db.refreshSession.deleteMany({
      where: { id: session.id, tokenHash: digest(token) },
    });
    if (consumed.count !== 1) throw new UnauthorizedException('Refresh token already used');
    return this.issue(session.userId, device);
  }
  async logout(token: string) {
    await this.db.refreshSession.deleteMany({ where: { tokenHash: digest(token) } });
  }
  me(actor: Actor) {
    return this.db.user.findUnique({
      where: { id: actor.id },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        globalRole: true,
        dateOfBirth: true,
        bloodGroup: true,
        allergies: true,
        emergencyContact: true,
        consentHistory: true,
        roles: true,
        doctor: true,
      },
    });
  }
  async requestOtp(email: string) {
    if (!process.env.SMTP_URL && process.env.DEMO_MODE !== 'true')
      throw new BadRequestException('Email delivery is not configured');
    const code = String(randomInt(100000, 1000000));
    const challenge = await this.db.otpChallenge.create({
      data: {
        email: email.toLowerCase(),
        hash: createHmac('sha256', process.env.OTP_PEPPER!).update(code).digest('hex'),
        expiresAt: new Date(Date.now() + 300000),
      },
    });
    if (process.env.SMTP_URL)
      await createTransport(process.env.SMTP_URL).sendMail({
        from: 'Careflow <no-reply@careflow.local>',
        to: email,
        subject: 'Your Careflow sign-in code',
        text: `Your code is ${code}. It expires in 5 minutes.`,
      });
    return {
      challengeId: challenge.id,
      ...(process.env.DEMO_MODE === 'true' ? { demoCode: code } : {}),
    };
  }
  async verifyOtp(challengeId: string, code: string, device: string) {
    const challenge = await this.db.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.expiresAt < new Date() || challenge.attempts >= 5)
      throw new UnauthorizedException('Code expired or invalid');
    // Atomic increment prevents concurrent guesses bypassing the limit.
    const attempt = await this.db.otpChallenge.updateMany({
      where: { id: challenge.id, attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
    if (
      !attempt.count ||
      createHmac('sha256', process.env.OTP_PEPPER!).update(code).digest('hex') !== challenge.hash
    )
      throw new UnauthorizedException('Code expired or invalid');
    const consumed = await this.db.otpChallenge.deleteMany({ where: { id: challenge.id } });
    if (!consumed.count) throw new UnauthorizedException('Code already used');
    const user = await this.db.user.findFirst({
      where: { email: challenge.email, deletedAt: null },
    });
    if (!user) throw new UnauthorizedException('Register before signing in');
    return this.issue(user.id, device);
  }
}
