import { loginBody } from '@xeno/shared';
import { router } from 'expo-router';
import { ArrowLeft, Lock, Mail } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { useTheme } from '@/design';
import { ApiError, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/forms';
import { Banner, Button, IconButton, Screen, Text, TextField } from '@/ui';
import { useSignIn } from './hooks';

type Field = 'email' | 'password';

export function SignInScreen() {
  const t = useTheme();
  const signIn = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const submit = () => {
    setFormError(null);
    const v = validate(loginBody, { email, password });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    signIn.mutate(v.data, {
      onError: (err) =>
        setFormError(
          err instanceof ApiError && err.status === 401 ? 'Email or password is incorrect' : errorMessage(err),
        ),
    });
  };

  return (
    <Screen
      keyboard
      headerLeft={<IconButton icon={ArrowLeft} accessibilityLabel="Back" onPress={() => router.back()} />}
    >
      <View style={{ gap: t.space.xs, marginBottom: t.space.xxl }}>
        <Text variant="title" accessibilityRole="header">
          Welcome back
        </Text>
        <Text variant="body" tone="textSecondary">
          Sign in to check on your garden.
        </Text>
      </View>

      <View style={{ gap: t.space.lg }}>
        {formError ? <Banner tone="danger" title={formError} /> : null}
        <TextField
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
          testID="sign-in-email"
        />
        <TextField
          ref={passwordRef}
          label="Password"
          icon={Lock}
          secure
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="sign-in-password"
        />
        <Button title="Sign in" onPress={submit} loading={signIn.isPending} fullWidth testID="sign-in-submit" />
        {__DEV__ ? (
          <Button
            title="Use demo account"
            variant="ghost"
            size="md"
            onPress={() => {
              setEmail('demo@xeno.garden');
              setPassword('demo-garden-1');
            }}
          />
        ) : null}
      </View>
    </Screen>
  );
}
