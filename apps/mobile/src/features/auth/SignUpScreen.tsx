import { registerBody } from '@xeno/shared';
import { router } from 'expo-router';
import { ArrowLeft, Lock, Mail, User } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { useTheme } from '@/design';
import { ApiError, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/forms';
import { Banner, Button, IconButton, Screen, Text, TextField } from '@/ui';
import { useSignUp } from './hooks';

type Field = 'name' | 'email' | 'password';

export function SignUpScreen() {
  const t = useTheme();
  const signUp = useSignUp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const submit = () => {
    setFormError(null);
    const v = validate(registerBody, { name, email, password });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    signUp.mutate(v.data, {
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'CONFLICT') {
          setErrors({ email: 'An account with this email already exists' });
        } else {
          setFormError(errorMessage(err));
        }
      },
    });
  };

  return (
    <Screen
      keyboard
      headerLeft={<IconButton icon={ArrowLeft} accessibilityLabel="Back" onPress={() => router.back()} />}
    >
      <View style={{ gap: t.space.xs, marginBottom: t.space.xxl }}>
        <Text variant="title" accessibilityRole="header">
          Create your account
        </Text>
        <Text variant="body" tone="textSecondary">
          One account for all your gardens, on any phone.
        </Text>
      </View>

      <View style={{ gap: t.space.lg }}>
        {formError ? <Banner tone="danger" title={formError} /> : null}
        <TextField
          label="Your name"
          icon={User}
          value={name}
          onChangeText={setName}
          error={errors.name}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          testID="sign-up-name"
        />
        <TextField
          ref={emailRef}
          label="Email"
          icon={Mail}
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          testID="sign-up-email"
        />
        <TextField
          ref={passwordRef}
          label="Password"
          icon={Lock}
          secure
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          hint="At least 8 characters"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="sign-up-password"
        />
        <Button title="Create account" onPress={submit} loading={signUp.isPending} fullWidth testID="sign-up-submit" />
        <Button title="Already have an account? Sign in" variant="ghost" onPress={() => router.replace('/sign-in')} />
      </View>
    </Screen>
  );
}
